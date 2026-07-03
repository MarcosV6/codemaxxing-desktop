import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  globSync as fsGlobSync,
  realpathSync,
} from 'fs'
import { homedir } from 'os'
import { join, relative, dirname, resolve, extname } from 'path'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import * as memoryStore from './memory.js'
import * as bg from './backgroundCommands.js'
import * as gitOps from './git.js'

function isInsideRoot(resolved: string, root: string): boolean {
  if (resolved === root) return true
  if (resolved.startsWith(root + '/')) return true
  if (process.platform === 'win32' && resolved.startsWith(root + '\\')) return true
  return false
}

function safePath(cwd: string, userPath: string | undefined | null): string | null {
  if (!userPath || typeof userPath !== 'string') return null
  const expandedPath =
    userPath === '~'
      ? homedir()
      : userPath.startsWith('~/') || userPath.startsWith('~\\')
        ? join(homedir(), userPath.slice(2))
        : userPath
  const resolved = resolve(cwd, expandedPath)
  const root = resolve(cwd)
  if (!isInsideRoot(resolved, root)) return null

  try {
    let probe = resolved
    while (probe && !existsSync(probe)) {
      const parent = dirname(probe)
      if (parent === probe) break
      probe = parent
    }
    if (existsSync(probe)) {
      const realProbe = realpathSync(probe)
      const realRoot = realpathSync(root)
      if (!isInsideRoot(realProbe, realRoot)) return null
    }
  } catch {
    // fall through to lexical check above
  }
  return resolved
}

function pathError(rawPath: unknown): string {
  if (rawPath === undefined || rawPath === null || rawPath === '') {
    return 'Error: Empty or missing path argument'
  }
  if (typeof rawPath !== 'string') {
    return `Error: Path argument must be a string, got ${typeof rawPath}`
  }
  return `Error: Path escapes project root: ${rawPath}`
}

const SHELL_FILE_WRITE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.go', '.h', '.hpp', '.html', '.ini', '.java',
  '.js', '.json', '.jsx', '.md', '.mjs', '.php', '.py', '.rb', '.rs', '.sass',
  '.scss', '.sh', '.sql', '.svelte', '.toml', '.ts', '.tsx', '.txt', '.vue',
  '.yaml', '.yml', '.zsh',
])

const SHELL_FILE_WRITE_BASENAMES = new Set([
  'dockerfile',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'index.html',
  'readme.md',
])

function normalizeShellTarget(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '')
}

function looksLikeProjectSourceTarget(target: string): boolean {
  const normalized = normalizeShellTarget(target).toLowerCase()
  if (!normalized) return false
  const base = normalized.split(/[\\/]/).pop() || normalized
  if (SHELL_FILE_WRITE_BASENAMES.has(base)) return true
  const extension = extname(base)
  if (extension && SHELL_FILE_WRITE_EXTENSIONS.has(extension)) return true
  return normalized.includes('/src/') || normalized.includes('\\src\\')
}

function extractShellWriteTargets(command: string): string[] {
  const targets: string[] = []
  const redirectRe = /(?:^|[^0-9])(?:>>?|1>>?|1>)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g
  const teeRe = /\btee\s+(?:-a\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g

  for (const regex of [redirectRe, teeRe]) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(command)) !== null) {
      const target = normalizeShellTarget(match[1] || match[2] || match[3] || '')
      if (target) targets.push(target)
    }
  }
  return targets
}

export function getShellFileWriteGuardReason(command: string): string | null {
  const targets = extractShellWriteTargets(command).filter(looksLikeProjectSourceTarget)
  if (targets.length === 0) return null

  const usesInlineShellFileWriting =
    /\b(?:cat|echo|printf|tee)\b/i.test(command) ||
    /<<['"]?[A-Za-z0-9_-]+['"]?/i.test(command) ||
    />/.test(command)

  if (!usesInlineShellFileWriting) return null

  const sample = targets.slice(0, 3).join(', ')
  return `Blocked: run_command should not be used to write project files (${sample}). Use write_file or edit_file for source/config files, then use run_command only for installs, builds, tests, or launching the app.`
}

// ── Tool schemas ──
export const FILE_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read (relative to project root)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Use this for new files or full rewrites only.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to write (relative to project root)' },
          content: { type: 'string', description: 'Content to write to the file' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Edit an existing file by replacing exact text. Prefer this over write_file for small or localized changes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit (relative to project root)' },
          oldText: { type: 'string', description: 'Exact text to find in the file' },
          newText: { type: 'string', description: 'Replacement text' },
          replaceAll: {
            type: 'boolean',
            description: 'Replace all exact matches instead of only the first one (default: false)',
          },
        },
        required: ['path', 'oldText', 'newText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories in the given path. Returns file names and types.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: "Directory path to list (relative to project root, defaults to '.')" },
          recursive: { type: 'boolean', description: 'Whether to list files recursively (default: false)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a text pattern across files in the project',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Text or regex pattern to search for' },
          path: { type: 'string', description: 'Directory to search in (defaults to project root)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Execute a shell command and return the output. Use for running installs, builds, tests, linters, and one-shot verification commands. Do NOT use this to create or edit project files with shell redirection, heredocs, echo, cat, or tee — use write_file/edit_file for source files. Package manager commands (npm install, yarn, pip install, cargo build, etc.) get a 5-minute timeout; other commands have a 30s timeout. Use run_background_command for long-running processes like dev servers.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Shell command to execute' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_background_command',
      description:
        'Start a long-running command in the background (e.g. dev servers, watch modes). Returns immediately with the process ID. Use this instead of run_command for processes that should keep running.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Shell command to run in the background' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view_image',
      description:
        'View an image file and describe what you see. Supports PNG, JPG, GIF, WebP. Returns the image as base64 for the model to analyze.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the image file (relative to project root, or absolute path)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_preview',
      description:
        "Open the app's Preview panel to a URL so the USER can see your running work (e.g. a dev server at http://localhost:3000). Use after starting a dev server or making a visible change. This only shows it to the user — use screenshot_preview to see it yourself.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open, e.g. http://localhost:3000' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshot_preview',
      description:
        "Capture a screenshot of a running web app and SEE it yourself — the image is returned for you to analyze. Use this to visually verify UI you build or change BEFORE telling the user it's done: build → screenshot → check it looks right → fix if not. Renders the URL at 1280×800 and also opens the Preview panel for the user.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to capture (e.g. http://localhost:3000). Omit to reuse the last opened preview URL.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: "Open a URL in the app's built-in browser (visible to the user). Use to research live docs, open a web app, or set up a page to read/screenshot/click. http(s) only.",
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'http(s) URL to open' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_read',
      description: 'Read the visible text of the page currently open in the built-in browser. Call browser_navigate first.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Screenshot the page open in the built-in browser and SEE it — returned as an image you can analyze.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element in the built-in browser by CSS selector or visible text (link/button), then read or screenshot the result.',
      parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector to click' }, text: { type: 'string', description: 'Visible text of a link/button (used if selector omitted)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input or textarea in the built-in browser, targeted by CSS selector. Fires input/change events so web apps react. Set submit=true to press Enter after typing (e.g. run a search or submit a form). Read or screenshot afterward to see the result.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input/textarea to type into' },
          text: { type: 'string', description: 'The text to type' },
          submit: { type: 'boolean', description: 'Press Enter / submit the form after typing (default false)' },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scroll the page in the built-in browser to reveal more content — by direction (down/up/top/bottom) or to a specific element (selector). Useful for lazy-loaded feeds and long pages before reading/clicking.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'], description: 'Scroll direction (default down)' },
          selector: { type: 'string', description: 'Optional CSS selector to scroll into view (overrides direction)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pixel_match',
      description: 'Compare the running UI to a target design image and find where they differ. Screenshots a URL (or the last preview), diffs it against the target image on disk, and reports an overall match % plus which screen regions diverge most — so you can iterate toward the design.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Path to the target/design image (PNG/JPG) to match against' },
          url: { type: 'string', description: 'URL to screenshot (e.g. http://localhost:3000). Omit to reuse the last opened preview.' },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_read',
      description: "Read the document currently open in the Documents workspace (its title + full content). Omit id to use the open doc. Use this before editing so you work from the latest text.",
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'Document id (optional; defaults to the open doc)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_write',
      description: "Replace the content (and optionally the title) of the open document in the Documents workspace. Pass the FULL new content. Omit id to write the open doc. The editor updates live.",
      parameters: { type: 'object', properties: { content: { type: 'string', description: 'Full new document content (Markdown)' }, title: { type: 'string', description: 'New title (optional)' }, id: { type: 'string', description: 'Document id (optional; defaults to the open doc)' } }, required: ['content'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_append',
      description: "Append text to the end of the open document (e.g. add a section). Omit id to use the open doc.",
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text to append' }, id: { type: 'string', description: 'Document id (optional; defaults to the open doc)' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_create',
      description: "Create a new document in the Documents workspace.",
      parameters: { type: 'object', properties: { title: { type: 'string', description: 'Title' }, content: { type: 'string', description: 'Initial content (Markdown, optional)' } }, required: ['title'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_list',
      description: 'List the documents in the Documents workspace (id + title).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'note_add',
      description: 'Add a note to the Notes & Tasks workspace.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'Note text' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_add',
      description: 'Add a task to the Notes & Tasks workspace.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'Task text' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_toggle',
      description: 'Toggle a task done/undone in the Notes & Tasks workspace, by id or by matching text.',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'Task id' }, text: { type: 'string', description: 'Match a task by its text (used if id omitted)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notes_list',
      description: 'List the current notes and tasks in the Notes & Tasks workspace.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'email_read',
      description: 'Read the email message currently open in the Email workspace (from/to/subject/body). Use before drafting a reply.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'email_send',
      description: "Send an email from the configured account in the Email workspace. Confirm the recipient and content with the user before sending.",
      parameters: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email address' }, subject: { type: 'string', description: 'Subject' }, text: { type: 'string', description: 'Plain-text body' } }, required: ['to', 'text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_list',
      description: 'List the upcoming events shown in the Calendar workspace.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_add',
      description: "Add an event to the user's calendar (CalDAV). Provide start (and optionally end) as ISO 8601 datetimes. Confirm details with the user first.",
      parameters: { type: 'object', properties: { summary: { type: 'string', description: 'Event title' }, start: { type: 'string', description: 'Start datetime, ISO 8601 (e.g. 2026-06-23T15:00:00)' }, end: { type: 'string', description: 'End datetime, ISO 8601 (optional; defaults to +1h)' }, location: { type: 'string', description: 'Location (optional)' } }, required: ['summary', 'start'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description:
        "Find files matching a glob pattern. Use this to locate files by name or extension across the project (e.g. '**/*.tsx', 'src/**/test.*', '*.json').",
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: "Glob pattern to match files (e.g. '**/*.ts', 'src/**/*.test.*')" },
          path: { type: 'string', description: "Directory to search in (relative to project root, defaults to '.')" },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Fetch the content of a URL. Use this to read documentation, APIs, or any web page. Returns the text content of the response.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
          method: { type: 'string', description: 'HTTP method (default: GET)' },
          headers: { type: 'object', description: 'Optional HTTP headers as key-value pairs' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for information. Returns a list of relevant results with titles, URLs, and snippets. Use this to find documentation, solutions, APIs, or any information not available locally.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          count: { type: 'number', description: 'Number of results to return (default: 5, max: 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'think',
      description:
        "Use this tool to think through complex problems step-by-step. Your thoughts are private and not shown to the user. Use this when you need to reason about architecture, plan multi-step changes, or work through a tricky bug before acting.",
      parameters: {
        type: 'object',
        properties: { thought: { type: 'string', description: 'Your internal reasoning or analysis' } },
        required: ['thought'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        "Create a task in the progress checklist shown to the user. Use this to break down your work into visible steps so the user can see what you're doing. Each task appears as a checklist item. Create tasks at the start of multi-step work.",
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: "Short task description (e.g., 'Read configuration files', 'Fix failing tests')" },
          active_label: { type: 'string', description: "Optional present-tense label shown while working (e.g., 'Reading config files...')" },
        },
        required: ['label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description:
        "Update the status of a task in the progress checklist. Mark tasks as 'in_progress' when you start working on them and 'completed' when done.",
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The task ID returned by create_task' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'New status for the task' },
        },
        required: ['id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Ask the user a clarifying question when the task requires information you do not have. Use sparingly — only when you genuinely cannot proceed without an answer. Returns the user\'s reply as a string.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user' },
          options: { type: 'array', items: { type: 'string' }, description: 'Optional short list of suggested answers' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash_output',
      description:
        'Read the accumulated stdout/stderr from a background command started with run_background_command. Returns recent output plus exit status. Use this to monitor dev servers, builds, or long-running processes.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The background job id returned by run_background_command' },
          sinceBytes: { type: 'number', description: 'Offset into stdout to read from (default: 0 — read everything)' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kill_bash',
      description: 'Terminate a background command started with run_background_command.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The background job id' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notebook_edit',
      description:
        'Edit a Jupyter notebook cell by index. Supports replacing cell source, inserting a new cell, or deleting a cell. Prefer this over raw JSON edits for .ipynb files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the .ipynb file' },
          cellIndex: { type: 'number', description: 'Zero-based cell index' },
          mode: { type: 'string', enum: ['replace', 'insert', 'delete'], description: 'Edit mode (default: replace)' },
          cellType: { type: 'string', enum: ['code', 'markdown'], description: 'Cell type when inserting (default: code)' },
          source: { type: 'string', description: 'New cell source (required for replace/insert)' },
        },
        required: ['path', 'cellIndex'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exit_plan_mode',
      description:
        'Signal that you are done planning and ready to execute. The user may be shown a plan summary and prompted to approve. Use this after an investigation-only mode where the next step is concrete changes.',
      parameters: {
        type: 'object',
        properties: { plan: { type: 'string', description: 'Short summary of the plan you will execute' } },
        required: ['plan'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description:
        "Save a memory for future sessions. Memory types: 'user' (who the user is / preferences), 'project' (current goals, deadlines), 'feedback' (corrections, validated choices), 'reference' (pointers to external systems). Keep content under ~300 chars, include the *why* for feedback/project entries.",
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['user', 'project', 'feedback', 'reference', 'preference', 'fact'], description: 'Memory type' },
          key: { type: 'string', description: 'Short stable identifier — updating same (type,key) overwrites' },
          content: { type: 'string', description: 'Memory content' },
          importance: { type: 'number', description: 'Weight 0.0-1.0 (default: 0.5)' },
          scope: { type: 'string', description: 'Optional scope (e.g. project path). Null for global memories.' },
        },
        required: ['type', 'key', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description:
        'Recall memories from prior sessions using full-text search. Use to look up what the user has told you before, recent project context, or feedback you were given.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (supports FTS5 prefix/phrase). Empty string = latest memories.' },
          type: { type: 'string', enum: ['user', 'project', 'feedback', 'reference', 'preference', 'fact'], description: 'Optional filter by type' },
          limit: { type: 'number', description: 'Max results (default: 5)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: 'Delete a memory by id. Use if information you previously saved is no longer accurate or relevant.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number', description: 'Memory id from recall results' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Show the git status of the working tree (branch, staged, modified, untracked).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Show the unified diff of unstaged (or staged) changes.',
      parameters: {
        type: 'object',
        properties: { staged: { type: 'boolean', description: 'If true, show staged diff (default: false)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'Show recent commits in short form.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'How many commits to show (default: 20)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description:
        'Stage (if requested) and commit changes with a message. Does NOT push. Asks for approval.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          stageAll: { type: 'boolean', description: 'If true, run `git add -A` first (default: false)' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Optional specific paths to stage before committing' },
        },
        required: ['message'],
      },
    },
  },
]

// ── In-session task tracker ──
export interface Task { id: number; label: string; active_label?: string; status: 'pending' | 'in_progress' | 'completed' }
export class TaskTracker {
  private tasks: Task[] = []
  private nextId = 1
  create(label: string, active_label?: string): number {
    const id = this.nextId++
    this.tasks.push({ id, label, active_label, status: 'pending' })
    return id
  }
  update(id: number, status: 'pending' | 'in_progress' | 'completed'): boolean {
    const t = this.tasks.find(t => t.id === id)
    if (!t) return false
    t.status = status
    return true
  }
  list(): Task[] { return [...this.tasks] }
  reset() { this.tasks = []; this.nextId = 1 }
}

// ── Executor ──
const IGNORE_DIRS = ['node_modules', '.git', 'dist', '.next', '__pycache__', 'dist-electron', 'release']

export interface ToolExecContext {
  cwd: string
  taskTracker: TaskTracker
  scope?: string | null
  // Streamed events for UI task checklist
  onTaskChange?: (tasks: Task[]) => void
  // Ask-user bridge (resolves when user replies in the UI)
  onAskUser?: (question: string, options?: string[]) => Promise<string>
  // Exit-plan-mode bridge (optional UI signal)
  onPlanExit?: (plan: string) => void
  // Preview bridges — let the agent show its work to the user (open the
  // Preview panel) and SEE its own work (offscreen screenshot returned as an
  // image the model can analyze). Undefined outside a normal coding run.
  openPreview?: (url: string) => void
  capturePreview?: (url?: string) => Promise<{ ok: boolean; mime?: string; base64?: string; error?: string }>
  // Drive the built-in browser (same webview the user sees). Round-trips to the
  // renderer; resolves with the action's result (page text, screenshot, etc.).
  browserCommand?: (cmd: { action: 'navigate' | 'read' | 'screenshot' | 'click' | 'type' | 'scroll'; url?: string; selector?: string; text?: string; submit?: boolean; direction?: string }) => Promise<{ ok: boolean; error?: string; title?: string; url?: string; text?: string; base64?: string }>
  // Visual pixel-match: screenshot a URL and diff it against a target design
  // image on disk; reports overall match + per-region (3×3) differences.
  pixelMatch?: (opts: { url?: string; targetPath: string }) => Promise<{ ok: boolean; matchPercent?: number; diffPercent?: number; regions?: Array<{ name: string; diffPercent: number }>; error?: string }>
  // Documents workspace — the agent reads/writes the document open in the editor.
  documentOp?: (op: { action: 'list' | 'read' | 'write' | 'append' | 'create'; id?: string; title?: string; content?: string; text?: string }) => Promise<{ ok: boolean; documents?: { id: string; title: string }[]; doc?: { id: string; title: string; content: string }; error?: string }>
  // Notes workspace — add/list notes & tasks.
  notesOp?: (op: { action: 'list' | 'add_note' | 'add_task' | 'toggle_task'; text?: string; id?: string }) => Promise<{ ok: boolean; notes?: { id: string; text: string }[]; tasks?: { id: string; text: string; done: boolean }[]; error?: string }>
  // Email workspace — read the open message + send mail.
  emailOp?: (op: { action: 'read' | 'send'; to?: string; subject?: string; text?: string }) => Promise<{ ok: boolean; message?: { from?: string; to?: string; subject?: string; text?: string }; error?: string }>
  // Calendar workspace — list events + add an event.
  calendarOp?: (op: { action: 'list' | 'add'; summary?: string; start?: number; end?: number; location?: string }) => Promise<{ ok: boolean; events?: { summary: string; start: number; end: number; location?: string }[]; error?: string }>
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<string> {
  const { cwd } = ctx
  switch (name) {
    case 'read_file': {
      const rawPath = (args.path ?? args.file_path ?? args.filepath ?? args.filename) as string | undefined
      if (!rawPath) return `Error: Missing required 'path' argument.`
      const filePath = safePath(cwd, rawPath)
      if (!filePath) return pathError(rawPath)
      if (!existsSync(filePath)) return `Error: File not found: ${rawPath}`
      try {
        if (extname(filePath).toLowerCase() === '.ipynb') {
          const raw = readFileSync(filePath, 'utf-8')
          const nb = JSON.parse(raw)
          const cells = nb.cells || []
          const parts: string[] = [`# Notebook: ${rawPath} (${cells.length} cells)\n`]
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            const cellType = cell.cell_type || 'unknown'
            const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source || ''
            parts.push(`## Cell ${i + 1} [${cellType}]`)
            if (cellType === 'code') parts.push('```python\n' + source + '\n```')
            else parts.push(source)
            parts.push('')
          }
          return parts.join('\n')
        }
        const content = readFileSync(filePath, 'utf-8')
        // Cap at 200KB for context safety
        if (content.length > 200_000) {
          return content.slice(0, 200_000) + `\n\n... (truncated, file is ${content.length} bytes)`
        }
        return content
      } catch (e: any) {
        return `Error reading file: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'write_file': {
      const rawPath = (args.path ?? args.file_path ?? args.filepath ?? args.filename) as string | undefined
      const rawContent = (args.content ?? args.text ?? args.data) as string | undefined
      if (!rawPath) return `Error: Missing required 'path' argument.`
      if (rawContent === undefined) return `Error: Missing required 'content' argument.`
      const filePath = safePath(cwd, rawPath)
      if (!filePath) return pathError(rawPath)
      try {
        const existed = existsSync(filePath)
        const oldContent = existed ? readFileSync(filePath, 'utf-8') : ''
        mkdirSync(dirname(filePath), { recursive: true })
        writeFileSync(filePath, rawContent, 'utf-8')
        const newLines = rawContent.split('\n')
        const added = existed ? newLines.filter(l => !oldContent.includes(l)).length : newLines.length
        const removed = existed ? oldContent.split('\n').filter(l => !rawContent.includes(l)).length : 0
        const diffStr = generateDiff(oldContent, rawContent, rawPath)
        return `✅ Wrote ${rawContent.length} bytes to ${rawPath}\n<<<DIFF>>>${rawPath}\n+${added} -${removed}\n${diffStr}<<<END_DIFF>>>`
      } catch (e: any) {
        return `Error writing file: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'edit_file': {
      const rawPath = (args.path ?? args.file_path ?? args.filepath ?? args.filename) as string | undefined
      if (!rawPath) return `Error: Missing required 'path' argument.`
      const filePath = safePath(cwd, rawPath)
      if (!filePath) return pathError(rawPath)
      if (!existsSync(filePath)) return `Error: File not found: ${rawPath}`
      try {
        const oldText = String(args.oldText ?? '')
        const newText = String(args.newText ?? '')
        const replaceAll = Boolean(args.replaceAll)
        const content = readFileSync(filePath, 'utf-8')
        if (!oldText) return 'Error: oldText cannot be empty.'
        if (oldText === newText) return 'Error: oldText and newText are identical — nothing to do.'

        let nextContent: string
        let replacements = 1
        let note = ''
        if (content.includes(oldText)) {
          const matchCount = content.split(oldText).length - 1
          if (!replaceAll && matchCount > 1) {
            return `Error: oldText matches ${matchCount} locations in ${rawPath}. Include more surrounding context or pass replaceAll=true.`
          }
          const parts = content.split(oldText)
          nextContent = replaceAll
            ? parts.join(newText)
            : parts[0] + newText + parts.slice(1).join(oldText)
          replacements = replaceAll ? matchCount : 1
        } else {
          // Exact match failed — the #1 cause is trailing-whitespace /
          // indentation drift in the model's copy of the text. Without a
          // fallback, models re-send the same near-miss forever. Retry with
          // a line-based match that ignores trailing whitespace; the real
          // file lines get replaced only on a single unambiguous hit.
          const trimEnd = (l: string) => l.replace(/[ \t]+$/, '')
          const contentLines = content.split('\n')
          const oldLines = oldText.split('\n').map(trimEnd)
          const starts: number[] = []
          for (let i = 0; i + oldLines.length <= contentLines.length; i++) {
            let ok = true
            for (let j = 0; j < oldLines.length; j++) {
              if (trimEnd(contentLines[i + j]) !== oldLines[j]) { ok = false; break }
            }
            if (ok) starts.push(i)
          }
          if (starts.length === 1) {
            const i = starts[0]
            const before = contentLines.slice(0, i)
            const after = contentLines.slice(i + oldLines.length)
            nextContent = [...before, newText, ...after].join('\n')
            note = ' — matched with trailing-whitespace tolerance'
          } else if (starts.length > 1) {
            return `Error: oldText isn't an exact match, and a whitespace-tolerant search finds ${starts.length} candidate locations in ${rawPath}. Include more surrounding lines to pin down one.`
          } else {
            return `Error: Could not find that text in ${rawPath}. The file may have changed since you read it — call read_file again and retry with the exact current text.`
          }
        }
        writeFileSync(filePath, nextContent, 'utf-8')
        const diffStr = generateDiff(content, nextContent, rawPath)
        const addedLines = newText.split('\n').length
        const removedLines = oldText.split('\n').length
        return `✅ Edited ${rawPath} (${replacements} replacement${replacements === 1 ? '' : 's'}${note})\n<<<DIFF>>>${rawPath}\n+${addedLines} -${removedLines}\n${diffStr}<<<END_DIFF>>>`
      } catch (e: any) {
        return `Error editing file: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'list_files': {
      const dirPath = safePath(cwd, (args.path as string) || '.')
      if (!dirPath) return pathError(args.path)
      if (!existsSync(dirPath)) return `Error: Directory not found: ${args.path}`
      try {
        const entries = listDir(dirPath, cwd, args.recursive as boolean)
        return entries.join('\n')
      } catch (e: any) {
        return `Error listing files: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'search_files': {
      const searchPath = safePath(cwd, (args.path as string) || '.')
      if (!searchPath) return pathError(args.path)
      try {
        return searchInFiles(searchPath, args.pattern as string, cwd)
      } catch (e: any) {
        return `Error searching: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'run_command': {
      try {
        const { execSync } = await import('child_process')
        const original = String(args.command ?? '')
        const blocked = getShellFileWriteGuardReason(original)
        if (blocked) return blocked

        const isLongRunning =
          /\b(npm\s+(install|i|ci|run\s+build|run\s+dev)|yarn(\s+install|\s+add)?|pnpm\s+(install|i|add)|bun\s+(install|i|add)|pip\s+install|cargo\s+build|go\s+build|mvn|gradle)\b/i.test(
            original,
          )
        const timeout = isLongRunning ? 300000 : 30000
        const maxBuffer = isLongRunning ? 10 * 1024 * 1024 : 1024 * 1024

        const output = execSync(original, {
          cwd,
          encoding: 'utf-8',
          timeout,
          maxBuffer,
        })
        return output || '(no output)'
      } catch (e: any) {
        if (e.killed) {
          const original = String(args.command ?? '')
          const isLongRunning =
            /\b(npm|yarn|pnpm|bun|pip|cargo|go|mvn|gradle)\b/i.test(original)
          const limitSecs = isLongRunning ? 300 : 30
          return `Command timed out after ${limitSecs}s: ${original}\nHint: Use run_background_command for long-running processes.`
        }
        return `Command failed: ${e.stderr || e.message || String(e)}`
      }
    }

    case 'run_background_command': {
      try {
        const command = String(args.command ?? '')
        const { id, pid } = bg.startBackground(command, cwd)
        await new Promise(r => setTimeout(r, 1500))
        const snap = bg.readBackground(id)
        if (snap && snap.closed && snap.exitCode !== null && snap.exitCode !== 0) {
          const errOut = (snap.stderr || snap.stdout).trim().slice(0, 1000)
          return `Command failed immediately (exit ${snap.exitCode})${errOut ? `:\n${errOut}` : ''}`
        }
        const preview = snap ? (snap.stdout || snap.stderr).trim().slice(0, 500) : ''
        return `✅ Started in background (id ${id}, PID ${pid ?? 'unknown'})${preview ? `\n\nEarly output:\n${preview}` : ''}\n\nUse bash_output with id="${id}" to read further output, kill_bash to stop it.`
      } catch (e: any) {
        return `Failed to start background command: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'view_image': {
      try {
        const userPath = String(args.path ?? '')
        const filePath = userPath.startsWith('/') ? userPath : safePath(cwd, userPath)
        if (!filePath) return pathError(userPath)
        if (!existsSync(filePath)) return `Error: Image not found: ${userPath}`
        const ext = extname(filePath).toLowerCase()
        const supported = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
        if (!supported.includes(ext)) return `Error: Unsupported image format: ${ext}`
        const data = readFileSync(filePath)
        const mime: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.bmp': 'image/bmp',
          '.svg': 'image/svg+xml',
        }
        return JSON.stringify({
          type: 'image',
          mime: mime[ext] || 'image/png',
          base64: data.toString('base64'),
          path: userPath,
          size: `${(data.length / 1024).toFixed(1)} KB`,
        })
      } catch (e: any) {
        return `Error viewing image: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'open_preview': {
      const url = String(args.url ?? '').trim()
      if (!url) return "Error: open_preview requires a 'url' (e.g. http://localhost:3000)."
      if (!ctx.openPreview) return 'Preview is not available in this environment.'
      ctx.openPreview(url)
      return `Opened the Preview panel at ${url} — the user can see it now. Call screenshot_preview to view it yourself.`
    }

    case 'screenshot_preview': {
      if (!ctx.capturePreview) return 'Preview screenshot is not available in this environment.'
      const url = args.url ? String(args.url).trim() : undefined
      const res = await ctx.capturePreview(url)
      if (!res.ok || !res.base64) {
        return `Could not capture the preview: ${res.error ?? 'no preview URL — call open_preview first or pass a url'}`
      }
      return JSON.stringify({ type: 'image', mime: res.mime ?? 'image/png', base64: res.base64, source: 'preview' })
    }

    case 'browser_navigate': {
      if (!ctx.browserCommand) return 'The built-in browser is not available in this environment.'
      const url = String(args.url ?? '').trim()
      // Gate to http(s): no file://, javascript:, data:, etc.
      if (!/^https?:\/\//i.test(url)) return "Error: browser_navigate needs an http(s) URL (got '" + url + "')."
      const r = await ctx.browserCommand({ action: 'navigate', url })
      if (!r.ok) return `Could not open ${url}: ${r.error ?? 'unknown error'}`
      return `Opened in the browser — ${r.title || '(untitled)'}\n${r.url || url}\n\nUse browser_read to read it, browser_screenshot to see it, or browser_click to interact.`
    }

    case 'browser_read': {
      if (!ctx.browserCommand) return 'The built-in browser is not available in this environment.'
      const r = await ctx.browserCommand({ action: 'read' })
      if (!r.ok) return `Could not read the page: ${r.error ?? 'unknown error'} (call browser_navigate first).`
      return `# ${r.title || r.url || 'Page'}\n${r.url || ''}\n\n${r.text || '(no readable text on this page)'}`
    }

    case 'browser_screenshot': {
      if (!ctx.browserCommand) return 'The built-in browser is not available in this environment.'
      const r = await ctx.browserCommand({ action: 'screenshot' })
      if (!r.ok || !r.base64) return `Could not screenshot the page: ${r.error ?? 'unknown error'} (call browser_navigate first).`
      return JSON.stringify({ type: 'image', mime: 'image/png', base64: r.base64, source: 'browser' })
    }

    case 'browser_click': {
      if (!ctx.browserCommand) return 'The built-in browser is not available in this environment.'
      const selector = args.selector ? String(args.selector) : undefined
      const text = args.text ? String(args.text) : undefined
      if (!selector && !text) return "Error: browser_click needs a 'selector' or 'text'."
      const r = await ctx.browserCommand({ action: 'click', selector, text })
      if (!r.ok) return `Could not click: ${r.error ?? 'no matching element'}.`
      return 'Clicked. Use browser_read or browser_screenshot to see what changed.'
    }

    case 'browser_type': {
      if (!ctx.browserCommand) return 'The built-in browser is not available in this environment.'
      const selector = String(args.selector ?? '').trim()
      const text = String(args.text ?? '')
      if (!selector) return "Error: browser_type needs a 'selector' for the input to type into."
      const submit = args.submit === true
      const r = await ctx.browserCommand({ action: 'type', selector, text, submit })
      if (!r.ok) return `Could not type into ${selector}: ${r.error ?? 'no matching element'}.`
      return submit
        ? `Typed and submitted. Now on:\n${r.url || '(same page)'}\n\nUse browser_read or browser_screenshot to see the result.`
        : 'Typed. Use browser_type submit=true or browser_click to submit, then read/screenshot.'
    }

    case 'browser_scroll': {
      if (!ctx.browserCommand) return 'The built-in browser is not available in this environment.'
      const selector = args.selector ? String(args.selector) : undefined
      const direction = args.direction ? String(args.direction) : 'down'
      const r = await ctx.browserCommand({ action: 'scroll', selector, direction })
      if (!r.ok) return `Could not scroll: ${r.error ?? 'unknown error'}.`
      return `Scrolled ${selector ? `to ${selector}` : direction}. Use browser_read or browser_screenshot to see what's now in view.`
    }

    case 'pixel_match': {
      if (!ctx.pixelMatch) return 'Pixel-match is not available in this environment.'
      const target = String(args.target ?? '').trim()
      if (!target) return "Error: pixel_match needs a 'target' image path."
      const url = args.url ? String(args.url).trim() : undefined
      const r = await ctx.pixelMatch({ url, targetPath: target })
      if (!r.ok) return `Could not pixel-match: ${r.error ?? 'unknown error'}`
      const worst = (r.regions ?? []).filter((x) => x.diffPercent > 2).sort((a, b) => b.diffPercent - a.diffPercent).slice(0, 3)
      const where = worst.length ? worst.map((w) => `${w.name} (${w.diffPercent.toFixed(0)}% off)`).join(', ') : 'negligible / evenly distributed'
      return `Visual match vs ${target}: ${(r.matchPercent ?? 0).toFixed(1)}% (${(r.diffPercent ?? 0).toFixed(1)}% of pixels differ).\nBiggest differences: ${where}.\nAdjust those regions, then call pixel_match again to re-check.`
    }

    case 'document_list': {
      if (!ctx.documentOp) return 'The Documents workspace is not available in this environment.'
      const r = await ctx.documentOp({ action: 'list' })
      if (!r.ok) return `Could not list documents: ${r.error ?? 'unknown error'}`
      if (!r.documents || r.documents.length === 0) return 'No documents yet.'
      return r.documents.map((d) => `- ${d.title || 'Untitled'} (id: ${d.id})`).join('\n')
    }
    case 'document_read': {
      if (!ctx.documentOp) return 'The Documents workspace is not available in this environment.'
      const r = await ctx.documentOp({ action: 'read', id: args.id ? String(args.id) : undefined })
      if (!r.ok || !r.doc) return `Could not read the document: ${r.error ?? 'unknown error'}`
      return `# ${r.doc.title || 'Untitled'} (id: ${r.doc.id})\n\n${r.doc.content || '(empty)'}`
    }
    case 'document_write': {
      if (!ctx.documentOp) return 'The Documents workspace is not available in this environment.'
      const content = String(args.content ?? '')
      const r = await ctx.documentOp({ action: 'write', id: args.id ? String(args.id) : undefined, title: args.title ? String(args.title) : undefined, content })
      if (!r.ok || !r.doc) return `Could not write the document: ${r.error ?? 'unknown error'}`
      return `Updated "${r.doc.title}" (${content.length} chars). The editor now shows your changes.`
    }
    case 'document_append': {
      if (!ctx.documentOp) return 'The Documents workspace is not available in this environment.'
      const text = String(args.text ?? '')
      if (!text) return "Error: document_append needs 'text'."
      const r = await ctx.documentOp({ action: 'append', id: args.id ? String(args.id) : undefined, text })
      if (!r.ok || !r.doc) return `Could not append: ${r.error ?? 'unknown error'}`
      return `Appended to "${r.doc.title}". The editor updated.`
    }
    case 'document_create': {
      if (!ctx.documentOp) return 'The Documents workspace is not available in this environment.'
      const title = String(args.title ?? 'Untitled')
      const r = await ctx.documentOp({ action: 'create', title, content: args.content ? String(args.content) : '' })
      if (!r.ok || !r.doc) return `Could not create the document: ${r.error ?? 'unknown error'}`
      return `Created "${r.doc.title}" (id: ${r.doc.id}).`
    }

    case 'note_add': {
      if (!ctx.notesOp) return 'The Notes workspace is not available in this environment.'
      const text = String(args.text ?? '').trim()
      if (!text) return "Error: note_add needs 'text'."
      const r = await ctx.notesOp({ action: 'add_note', text })
      return r.ok ? `Added note: "${text}".` : `Could not add note: ${r.error ?? 'unknown error'}`
    }
    case 'task_add': {
      if (!ctx.notesOp) return 'The Notes workspace is not available in this environment.'
      const text = String(args.text ?? '').trim()
      if (!text) return "Error: task_add needs 'text'."
      const r = await ctx.notesOp({ action: 'add_task', text })
      return r.ok ? `Added task: "${text}".` : `Could not add task: ${r.error ?? 'unknown error'}`
    }
    case 'task_toggle': {
      if (!ctx.notesOp) return 'The Notes workspace is not available in this environment.'
      const r = await ctx.notesOp({ action: 'toggle_task', id: args.id ? String(args.id) : undefined, text: args.text ? String(args.text) : undefined })
      return r.ok ? 'Toggled the task.' : `Could not toggle: ${r.error ?? 'no matching task'}`
    }
    case 'notes_list': {
      if (!ctx.notesOp) return 'The Notes workspace is not available in this environment.'
      const r = await ctx.notesOp({ action: 'list' })
      if (!r.ok) return `Could not list: ${r.error ?? 'unknown error'}`
      const notes = (r.notes ?? []).map((n) => `- ${n.text}`).join('\n') || '(none)'
      const tasks = (r.tasks ?? []).map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`).join('\n') || '(none)'
      return `# Notes\n${notes}\n\n# Tasks\n${tasks}`
    }

    case 'email_read': {
      if (!ctx.emailOp) return 'The Email workspace is not available in this environment.'
      const r = await ctx.emailOp({ action: 'read' })
      if (!r.ok || !r.message) return `Could not read the email: ${r.error ?? 'unknown error'}`
      const m = r.message
      return `From: ${m.from || ''}\nTo: ${m.to || ''}\nSubject: ${m.subject || ''}\n\n${m.text || '(no body)'}`
    }
    case 'email_send': {
      if (!ctx.emailOp) return 'The Email workspace is not available in this environment.'
      const to = String(args.to ?? '').trim()
      if (!to) return "Error: email_send needs 'to'."
      const r = await ctx.emailOp({ action: 'send', to, subject: args.subject ? String(args.subject) : undefined, text: args.text ? String(args.text) : '' })
      return r.ok ? `Email sent to ${to}.` : `Could not send: ${r.error ?? 'unknown error'}`
    }

    case 'calendar_list': {
      if (!ctx.calendarOp) return 'The Calendar workspace is not available in this environment.'
      const r = await ctx.calendarOp({ action: 'list' })
      if (!r.ok) return `Could not list events: ${r.error ?? 'unknown error'}`
      if (!r.events || r.events.length === 0) return 'No upcoming events.'
      return r.events.map((e) => `- ${new Date(e.start).toLocaleString()} — ${e.summary}${e.location ? ` @ ${e.location}` : ''}`).join('\n')
    }
    case 'calendar_add': {
      if (!ctx.calendarOp) return 'The Calendar workspace is not available in this environment.'
      const summary = String(args.summary ?? '').trim()
      if (!summary) return "Error: calendar_add needs 'summary'."
      const startMs = args.start ? Date.parse(String(args.start)) : NaN
      if (!startMs || Number.isNaN(startMs)) return "Error: calendar_add needs a valid 'start' (ISO 8601 datetime)."
      const endParsed = args.end ? Date.parse(String(args.end)) : NaN
      const r = await ctx.calendarOp({ action: 'add', summary, start: startMs, end: Number.isNaN(endParsed) ? undefined : endParsed, location: args.location ? String(args.location) : undefined })
      return r.ok ? `Added "${summary}" to your calendar.` : `Could not add the event: ${r.error ?? 'unknown error'}`
    }

    case 'glob': {
      try {
        const pattern = String(args.pattern ?? '')
        const baseDir = safePath(cwd, (args.path as string) || '.') || cwd
        const matches = fsGlobSync(pattern, { cwd: baseDir })
          .map((f: string) => relative(cwd, join(baseDir, f)))
          .filter((f: string) => !IGNORE_DIRS.some(d => f.startsWith(d + '/') || f.includes('/' + d + '/')))
          .sort()
        if (matches.length === 0) return `No files matching: ${pattern}`
        return matches.slice(0, 100).join('\n') + (matches.length > 100 ? `\n... (${matches.length - 100} more)` : '')
      } catch (e: any) {
        return `Error globbing: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'web_fetch': {
      try {
        const url = String(args.url ?? '')
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return 'Error: URL must start with http:// or https://'
        }
        const method = String(args.method ?? 'GET').toUpperCase()
        const headers = (args.headers as Record<string, string>) || {}
        const controller = new AbortController()
        const to = setTimeout(() => controller.abort(), 15000)
        const res = await fetch(url, { method, headers, signal: controller.signal })
        clearTimeout(to)
        const contentType = res.headers.get('content-type') || ''
        const text = await res.text()
        let content = text
        if (contentType.includes('text/html')) {
          content = text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
        }
        if (content.length > 50000) content = content.slice(0, 50000) + `\n\n... (truncated)`
        return `HTTP ${res.status} ${res.statusText}\nContent-Type: ${contentType}\n\n${content}`
      } catch (e: any) {
        return `Error fetching URL: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'web_search': {
      try {
        const query = String(args.query ?? '')
        if (!query) return 'Error: search query is required'
        const count = Math.min(Number(args.count ?? 5), 10)
        const encoded = encodeURIComponent(query)
        const controller = new AbortController()
        const to = setTimeout(() => controller.abort(), 15000)
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; codemaxxing/1.0)' },
          signal: controller.signal,
        })
        clearTimeout(to)
        const html = await res.text()
        const results: string[] = []
        const re = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
        let match: RegExpExecArray | null
        while ((match = re.exec(html)) !== null && results.length < count) {
          const url = match[1].replace(/&amp;/g, '&')
          const title = match[2].replace(/<[^>]+>/g, '').trim()
          const snippet = match[3].replace(/<[^>]+>/g, '').trim()
          if (title && url) results.push(`${results.length + 1}. ${title}\n   ${url}\n   ${snippet}`)
        }
        return results.length > 0
          ? `Search results for "${query}":\n\n${results.join('\n\n')}`
          : `No results found for "${query}".`
      } catch (e: any) {
        return `Error searching: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'think':
      return '(thinking complete)'

    case 'create_task': {
      const id = ctx.taskTracker.create(String(args.label), args.active_label ? String(args.active_label) : undefined)
      ctx.onTaskChange?.(ctx.taskTracker.list())
      return `Task #${id} created.`
    }

    case 'update_task': {
      const ok = ctx.taskTracker.update(Number(args.id), String(args.status) as any)
      ctx.onTaskChange?.(ctx.taskTracker.list())
      return ok ? `Task #${args.id} updated to ${args.status}.` : `Task #${args.id} not found.`
    }

    case 'ask_user': {
      const question = String(args.question ?? '').trim()
      if (!question) return 'Error: question is required.'
      const options = Array.isArray(args.options) ? (args.options as string[]).slice(0, 8) : undefined
      if (!ctx.onAskUser) return 'Error: ask_user is not available in this environment.'
      try {
        const reply = await ctx.onAskUser(question, options)
        return reply?.trim() || '(user did not reply)'
      } catch (e: any) {
        return `Error: ${e?.message ?? String(e)}`
      }
    }

    case 'bash_output': {
      const id = String(args.id ?? '')
      if (!id) return 'Error: id is required.'
      const since = Number(args.sinceBytes ?? 0) || 0
      const out = bg.readBackground(id, since)
      if (!out) return `Error: Unknown background job ${id}`
      const tail = (s: string) => s.length > 20_000 ? s.slice(-20_000) + '\n...(truncated to last 20KB)' : s
      const status = out.closed
        ? `(exited${out.exitCode !== null ? ` with code ${out.exitCode}` : ''})`
        : '(still running)'
      const parts: string[] = [status]
      if (out.stdout) parts.push(`--- stdout ---\n${tail(out.stdout)}`)
      if (out.stderr) parts.push(`--- stderr ---\n${tail(out.stderr)}`)
      return parts.join('\n\n') || '(no output yet)'
    }

    case 'kill_bash': {
      const id = String(args.id ?? '')
      if (!id) return 'Error: id is required.'
      return bg.killBackground(id) ? `Sent SIGTERM to ${id}.` : `Error: Unknown background job ${id}`
    }

    case 'notebook_edit': {
      const rawPath = (args.path ?? args.file_path) as string | undefined
      if (!rawPath) return `Error: Missing required 'path' argument.`
      const filePath = safePath(cwd, rawPath)
      if (!filePath) return pathError(rawPath)
      if (!existsSync(filePath)) return `Error: File not found: ${rawPath}`
      if (extname(filePath).toLowerCase() !== '.ipynb') return 'Error: path must be a .ipynb file'
      try {
        const nb = JSON.parse(readFileSync(filePath, 'utf-8'))
        const cells = Array.isArray(nb.cells) ? nb.cells : []
        const idx = Number(args.cellIndex)
        const mode = String(args.mode ?? 'replace')
        const source = args.source !== undefined ? String(args.source) : ''
        const cellType = String(args.cellType ?? 'code')
        if (mode === 'delete') {
          if (idx < 0 || idx >= cells.length) return `Error: cellIndex ${idx} out of range (0-${cells.length - 1})`
          cells.splice(idx, 1)
        } else if (mode === 'insert') {
          const newCell = cellType === 'markdown'
            ? { cell_type: 'markdown', metadata: {}, source: source.split(/(?<=\n)/) }
            : { cell_type: 'code', metadata: {}, source: source.split(/(?<=\n)/), outputs: [], execution_count: null }
          cells.splice(Math.max(0, Math.min(idx, cells.length)), 0, newCell)
        } else {
          if (idx < 0 || idx >= cells.length) return `Error: cellIndex ${idx} out of range`
          cells[idx].source = source.split(/(?<=\n)/)
          if (cells[idx].cell_type === 'code') { cells[idx].outputs = []; cells[idx].execution_count = null }
        }
        nb.cells = cells
        writeFileSync(filePath, JSON.stringify(nb, null, 1), 'utf-8')
        return `✅ Notebook ${rawPath} — ${mode} cell ${idx}`
      } catch (e: any) {
        return `Error editing notebook: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'exit_plan_mode': {
      const plan = String(args.plan ?? '').trim()
      if (!plan) return 'Error: plan is required.'
      ctx.onPlanExit?.(plan)
      return `Plan captured. Ready to execute:\n${plan}`
    }

    case 'remember': {
      try {
        const type = String(args.type ?? '') as memoryStore.MemoryType
        const key = String(args.key ?? '').trim()
        const content = String(args.content ?? '').trim()
        if (!type || !key || !content) return 'Error: type, key, and content are required.'
        const id = memoryStore.remember(type, key, content, {
          scope: (args.scope as string | null | undefined) ?? ctx.scope ?? null,
          importance: typeof args.importance === 'number' ? Math.max(0, Math.min(1, args.importance)) : 0.5,
        })
        return `Saved memory #${id} (${type}/${key}).`
      } catch (e: any) {
        return `Error saving memory: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'recall': {
      try {
        const query = String(args.query ?? '')
        const type = args.type ? (String(args.type) as memoryStore.MemoryType) : undefined
        const limit = Math.max(1, Math.min(20, Number(args.limit ?? 5)))
        const rows = memoryStore.recall(query, type, ctx.scope ?? undefined, limit)
        if (rows.length === 0) return '(no matching memories)'
        return rows.map(r => `#${r.id} [${r.type}] ${r.key} — ${r.content.slice(0, 300)}`).join('\n')
      } catch (e: any) {
        return `Error recalling memories: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'forget': {
      try {
        const id = Number(args.id)
        if (!Number.isFinite(id)) return 'Error: id (number) is required.'
        return memoryStore.forget(id) ? `Forgot memory #${id}.` : `Memory #${id} not found.`
      } catch (e: any) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    case 'git_status': {
      if (!gitOps.isGitRepo(cwd)) return 'Error: not a git repository'
      const summary = await gitOps.gitSummary(cwd)
      return `branch: ${summary.branch}\nstaged: ${summary.staged}  modified: ${summary.modified}  untracked: ${summary.untracked}\n\n${summary.status}`
    }

    case 'git_diff': {
      if (!gitOps.isGitRepo(cwd)) return 'Error: not a git repository'
      const staged = Boolean(args.staged)
      const diff = await gitOps.gitDiff(cwd, staged)
      if (diff.length > 50_000) return diff.slice(0, 50_000) + `\n\n... (diff truncated, ${diff.length} bytes total)`
      return diff
    }

    case 'git_log': {
      if (!gitOps.isGitRepo(cwd)) return 'Error: not a git repository'
      const limit = Math.max(1, Math.min(200, Number(args.limit ?? 20)))
      return gitOps.gitLog(cwd, limit)
    }

    case 'git_commit': {
      if (!gitOps.isGitRepo(cwd)) return 'Error: not a git repository'
      const message = String(args.message ?? '').trim()
      if (!message) return 'Error: message is required'
      if (args.stageAll) await gitOps.gitStageAll(cwd)
      else if (Array.isArray(args.paths) && args.paths.length > 0) await gitOps.gitStage(cwd, args.paths as string[])
      return gitOps.gitCommit(cwd, message)
    }

    default:
      return `Unknown tool: ${name}`
  }
}

// ── Diff (Myers-lite LCS) ──
export function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const output: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`]
  const lcs = computeLCS(oldLines, newLines)
  let oi = 0, ni = 0, li = 0
  let hunkLines: string[] = []
  let hunkOldCount = 0, hunkNewCount = 0
  let hunkStartOld = 1, hunkStartNew = 1
  let pendingContext: string[] = []
  let hasHunk = false
  function flushHunk() {
    if (hasHunk && hunkLines.length > 0) {
      output.push(`@@ -${hunkStartOld},${hunkOldCount} +${hunkStartNew},${hunkNewCount} @@`)
      output.push(...hunkLines)
    }
    hunkLines = []; hunkOldCount = 0; hunkNewCount = 0; hasHunk = false; pendingContext = []
  }
  function startHunk() {
    if (!hasHunk) {
      hasHunk = true
      hunkStartOld = Math.max(1, oi + 1 - 3)
      hunkStartNew = Math.max(1, ni + 1 - 3)
      for (let c = Math.max(0, oi - 3); c < oi; c++) {
        hunkLines.push(` ${oldLines[c]}`); hunkOldCount++; hunkNewCount++
      }
    }
    if (pendingContext.length > 0) { hunkLines.push(...pendingContext); pendingContext = [] }
  }
  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && ni < newLines.length && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
      if (hasHunk) {
        pendingContext.push(` ${oldLines[oi]}`); hunkOldCount++; hunkNewCount++
        if (pendingContext.length > 6) flushHunk()
      }
      oi++; ni++; li++
    } else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
      startHunk(); hunkLines.push(`-${oldLines[oi]}`); hunkOldCount++; oi++
    } else if (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
      startHunk(); hunkLines.push(`+${newLines[ni]}`); hunkNewCount++; ni++
    } else break
  }
  flushHunk()
  if (output.length <= 2) return '(no changes)'
  const maxDiff = 60
  if (output.length > maxDiff + 2) return output.slice(0, maxDiff + 2).join('\n') + `\n... (${output.length - maxDiff - 2} more lines)`
  return output.join('\n')
}

function computeLCS(a: string[], b: string[]): string[] {
  if (a.length > 500 || b.length > 500) {
    const result: string[] = []
    let bi = 0
    for (const line of a) {
      while (bi < b.length && b[bi] !== line) bi++
      if (bi < b.length) { result.push(line); bi++ }
    }
    return result
  }
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const result: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.unshift(a[i - 1]); i--; j-- }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--
    else j--
  }
  return result
}

export function getExistingContent(filePath: string, cwd: string): string | null {
  const fullPath = safePath(cwd, filePath)
  if (!fullPath || !existsSync(fullPath)) return null
  try { return readFileSync(fullPath, 'utf-8') } catch { return null }
}

function listDir(dirPath: string, cwd: string, recursive = false, depth = 0): string[] {
  const entries: string[] = []
  for (const entry of readdirSync(dirPath)) {
    if (IGNORE_DIRS.includes(entry)) continue
    const fullPath = join(dirPath, entry)
    const rel = relative(cwd, fullPath)
    let stat
    try { stat = statSync(fullPath) } catch { continue }
    const prefix = '  '.repeat(depth)
    if (stat.isDirectory()) {
      entries.push(`${prefix}📁 ${rel}/`)
      if (recursive && depth < 3) entries.push(...listDir(fullPath, cwd, true, depth + 1))
    } else {
      const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`
      entries.push(`${prefix}📄 ${rel} (${size})`)
    }
  }
  return entries
}

function detectReDoSHazard(pattern: string): string | null {
  if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern)) return 'nested quantifier on a repeated group'
  if (/\([^()]*\|[^()]*\)[+*]/.test(pattern)) return 'alternation under an unbounded quantifier'
  if (/\.[+*].*\.[+*]/.test(pattern)) return 'multiple unbounded dot-quantifiers'
  return null
}

function searchInFiles(dirPath: string, pattern: string, cwd: string): string {
  const results: string[] = []
  if (typeof pattern !== 'string' || pattern.length === 0) return 'Error: search pattern must be a non-empty string'
  if (pattern.length > 500) return 'Error: search pattern too long (max 500 chars)'
  const hazard = detectReDoSHazard(pattern)
  if (hazard) return `Error: regex rejected (potential ReDoS): ${hazard}.`
  let regex: RegExp
  try { regex = new RegExp(pattern, 'gi') } catch (e: any) { return `Error: invalid regex pattern: ${e.message}` }
  function search(dir: string) {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry)) continue
      const fullPath = join(dir, entry)
      let stat
      try { stat = statSync(fullPath) } catch { continue }
      if (stat.isDirectory()) search(fullPath)
      else if (stat.size < 100000) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${relative(cwd, fullPath)}:${i + 1}: ${lines[i].trim()}`)
            }
            regex.lastIndex = 0
          }
        } catch { /* skip binary */ }
      }
    }
  }
  search(dirPath)
  return results.length > 0 ? results.slice(0, 50).join('\n') : 'No matches found.'
}
