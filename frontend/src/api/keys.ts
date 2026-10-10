/**
 * Query keys. Hierarchical so whole families can be invalidated:
 *   invalidate(['tasks']) refreshes every task list; ['project', id] refreshes everything about one project.
 */
export type TaskFilters = Record<string, string | string[] | number | boolean | undefined | null>

export const qk = {
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (wid: string) => ['workspace', wid] as const,
  members: (wid: string, includeDeactivated = false) => ['members', wid, includeDeactivated] as const,
  labels: (wid: string) => ['labels', wid] as const,
  invitations: (wid: string) => ['invitations', wid] as const,
  sessions: ['sessions'] as const,

  projects: (wid: string, includeArchived = false) => ['projects', wid, includeArchived] as const,
  project: (pid: string) => ['project', pid] as const,
  projectMembers: (pid: string) => ['project', pid, 'members'] as const,
  statuses: (pid: string) => ['project', pid, 'statuses'] as const,
  milestones: (pid: string) => ['project', pid, 'milestones'] as const,
  updates: (pid: string) => ['project', pid, 'updates'] as const,
  projectActivity: (pid: string) => ['project', pid, 'activity'] as const,
  projectInsights: (pid: string) => ['project', pid, 'insights'] as const,

  projectTasks: (pid: string, filters: TaskFilters = {}) => ['tasks', 'project', pid, filters] as const,
  workspaceTasks: (wid: string, filters: TaskFilters = {}) => ['tasks', 'workspace', wid, filters] as const,
  task: (tid: string) => ['task', tid] as const,
  taskByRef: (wid: string, ref: string) => ['task', 'ref', wid, ref.toUpperCase()] as const,
  taskComments: (tid: string) => ['task', tid, 'comments'] as const,
  taskAttachments: (tid: string) => ['task', tid, 'attachments'] as const,
  taskActivity: (tid: string) => ['task', tid, 'activity'] as const,

  notifications: (wid?: string, unreadOnly = false) => ['notifications', 'list', wid ?? 'all', unreadOnly] as const,
  unreadCount: (wid?: string) => ['notifications', 'unread', wid ?? 'all'] as const,

  timer: ['timer'] as const,
  timeEntries: (wid: string, filters: TaskFilters = {}) => ['time', wid, filters] as const,

  home: (wid: string) => ['home', wid] as const,
  portfolio: (wid: string) => ['insights', 'portfolio', wid] as const,
  workload: (wid: string, params: TaskFilters = {}) => ['insights', 'workload', wid, params] as const,
  timeReport: (wid: string, params: TaskFilters = {}) => ['insights', 'time', wid, params] as const,
  workspaceActivity: (wid: string) => ['activity', wid] as const,
  search: (wid: string, q: string) => ['search', wid, q] as const,
}
