import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CheckSquare, Paperclip, MessageSquare, History, Trash2, Plus, X, Download, Send, Loader2, FolderKanban,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from './ui/sheet';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { UserAvatar, DueChip, ProgressBar } from './common';
import { useTaskDrawer } from '../contexts/TaskDrawerContext';
import { useAuth } from '../contexts/AuthContext';
import { tasksApi, commentsApi, filesApi, usersApi, projectsApi, errorMessage } from '../lib/api';
import {
  TASK_STATUSES, statusConfig, PRIORITIES, priorityConfig, timeAgo, formatBytes,
} from '../lib/constants';

const NONE = '__none';

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export default function TaskDrawer() {
  const { taskId, closeTask, notifyChanged } = useTaskDrawer();
  const { user } = useAuth();
  const [task, setTask] = useState(null);
  const [project, setProject] = useState(null);
  const [users, setUsers] = useState([]);
  const [comments, setComments] = useState([]);
  const [files, setFiles] = useState([]);
  const [activity, setActivity] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [estimate, setEstimate] = useState('');
  const [newItem, setNewItem] = useState('');
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    if (!taskId) return;
    try {
      const t = (await tasksApi.get(taskId)).data;
      setTask(t);
      setTitle(t.title);
      setDescription(t.description || '');
      setEstimate(t.estimate_hours ?? '');
      const [c, f, u, p, a] = await Promise.allSettled([
        commentsApi.list('task', taskId),
        filesApi.list('task', taskId),
        usersApi.list(),
        projectsApi.get(t.project_id),
        projectsApi.activity(t.project_id, 200),
      ]);
      if (c.status === 'fulfilled') setComments(c.value.data);
      if (f.status === 'fulfilled') setFiles(f.value.data);
      if (u.status === 'fulfilled') setUsers(u.value.data);
      setProject(p.status === 'fulfilled' ? p.value.data : null);
      if (a.status === 'fulfilled') setActivity(a.value.data.filter((x) => x.entity_id === taskId));
    } catch (err) {
      toast.error(errorMessage(err, 'Could not open task'));
      closeTask();
    }
  }, [taskId, closeTask]);

  useEffect(() => {
    setTask(null);
    setComments([]);
    setFiles([]);
    setActivity([]);
    load();
  }, [load]);

  const save = async (changes, successMsg) => {
    const prev = task;
    setTask((t) => ({ ...t, ...changes }));
    try {
      const res = await tasksApi.update(task.task_id, changes);
      setTask(res.data);
      notifyChanged();
      if (successMsg) toast.success(successMsg);
      return true;
    } catch (err) {
      setTask(prev);
      toast.error(errorMessage(err, 'Could not save'));
      return false;
    }
  };

  const team = useMemo(() => {
    const ids = new Set(project?.team_members || []);
    const onTeam = users.filter((u) => ids.has(u.user_id));
    const others = users.filter((u) => !ids.has(u.user_id));
    return { onTeam, others };
  }, [users, project]);

  if (!taskId) return null;
  const canEdit = !!task?.can_edit;
  const canUpdate = !!task?.can_update;
  const checklist = task?.checklist || [];
  const doneCount = checklist.filter((c) => c.done).length;

  const saveTitle = () => {
    const v = title.trim();
    if (v && v !== task.title) save({ title: v });
    else setTitle(task.title);
  };
  const saveDescription = () => {
    if (description !== (task.description || '')) save({ description });
  };
  const saveEstimate = () => {
    const v = estimate === '' ? null : Number(estimate);
    if (v !== (task.estimate_hours ?? null) && (v === null || !Number.isNaN(v))) save({ estimate_hours: v });
  };

  const toggleItem = (id) => save({ checklist: checklist.map((c) => (c.id === id ? { ...c, done: !c.done } : c)) });
  const removeItem = (id) => save({ checklist: checklist.filter((c) => c.id !== id) });
  const addItem = async (e) => {
    e.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    if (await save({ checklist: [...checklist.map(({ id, text: t, done }) => ({ id, text: t, done })), { id: `chk_${Date.now().toString(36)}`, text, done: false }] })) {
      setNewItem('');
    }
  };

  const postComment = async (e) => {
    e?.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    try {
      const res = await commentsApi.create({ content: comment, entity_type: 'task', entity_id: task.task_id });
      setComments((c) => [...c, res.data]);
      setComment('');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not post comment'));
    } finally {
      setPosting(false);
    }
  };

  const deleteComment = async (id) => {
    try {
      await commentsApi.delete(id);
      setComments((c) => c.filter((x) => x.comment_id !== id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entity_type', 'task');
    fd.append('entity_id', task.task_id);
    setUploading(true);
    try {
      const res = await filesApi.upload(fd);
      setFiles((f) => [res.data, ...f]);
      toast.success(`Uploaded ${res.data.original_name}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (f) => {
    if (!window.confirm(`Delete ${f.original_name}?`)) return;
    try {
      await filesApi.delete(f.file_id);
      setFiles((all) => all.filter((x) => x.file_id !== f.file_id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const deleteTask = async () => {
    if (!window.confirm(`Delete "${task.title}"? This also removes its comments and files.`)) return;
    try {
      await tasksApi.delete(task.task_id);
      toast.success('Task deleted');
      notifyChanged();
      closeTask();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // @mention autocomplete: suggest teammates while typing "@na..."
  const mentionMatch = comment.match(/@([\w-]*)$/);
  const mentionOptions = mentionMatch
    ? team.onTeam.filter((u) => u.user_id !== user?.user_id && u.name.toLowerCase().startsWith(mentionMatch[1].toLowerCase())).slice(0, 5)
    : [];
  const insertMention = (name) => setComment((c) => c.replace(/@([\w-]*)$/, `@${name} `));

  return (
    <Sheet open={!!taskId} onOpenChange={(o) => !o && closeTask()}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col gap-0 overflow-hidden" data-testid="task-drawer">
        {!task ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <SheetTitle className="sr-only">Loading task</SheetTitle>
            <SheetDescription className="sr-only">Loading</SheetDescription>
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="px-6 pt-6 pb-4 border-b border-border/40 space-y-3">
              <Link to={`/projects/${task.project_id}`} onClick={closeTask}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                <FolderKanban size={12} /> {task.project_name}
              </Link>
              <SheetTitle className="sr-only">{task.title}</SheetTitle>
              <SheetDescription className="sr-only">Task details</SheetDescription>
              {canEdit ? (
                <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="text-lg md:text-lg font-semibold font-['Outfit'] border-transparent px-0 focus-visible:px-2 h-auto py-1 bg-transparent"
                  data-testid="task-title-edit" />
              ) : (
                <h2 className="text-lg font-semibold font-['Outfit'] pr-6">{task.title}</h2>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={task.status} onValueChange={(v) => save({ status: v })} disabled={!canUpdate}>
                  <SelectTrigger className={`w-40 h-8 text-xs ${statusConfig[task.status]?.color}`} data-testid="task-status-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <DueChip task={task} />
                {!canUpdate && <span className="text-[11px] text-muted-foreground">View only</span>}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Assignee">
                  <Select value={task.assigned_to || NONE} disabled={!canEdit}
                    onValueChange={(v) => save({ assigned_to: v === NONE ? null : v })}>
                    <SelectTrigger className="h-9" data-testid="task-assignee-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unassigned</SelectItem>
                      {team.onTeam.map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>)}
                      {team.others.length > 0 && <div className="px-2 pt-2 pb-1 text-[10px] uppercase text-muted-foreground">Not on project (will be added)</div>}
                      {team.others.map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>)}
                      {task.assigned_to && !users.some((u) => u.user_id === task.assigned_to) && (
                        <SelectItem value={task.assigned_to}>{task.assigned_to_name || 'Unknown'}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={task.priority} disabled={!canEdit} onValueChange={(v) => save({ priority: v })}>
                    <SelectTrigger className={`h-9 ${priorityConfig[task.priority]?.color}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{priorityConfig[p].label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Start date">
                  <Input type="date" className="h-9" value={task.start_date || ''} disabled={!canEdit}
                    onChange={(e) => save({ start_date: e.target.value || null })} />
                </Field>
                <Field label="Due date">
                  <Input type="date" className="h-9" value={task.due_date || ''} disabled={!canEdit}
                    onChange={(e) => save({ due_date: e.target.value || null })} data-testid="task-due-input" />
                </Field>
                <Field label="Estimate (hours)">
                  <Input type="number" min="0" step="0.5" className="h-9" value={estimate} disabled={!canEdit}
                    placeholder="—" onChange={(e) => setEstimate(e.target.value)} onBlur={saveEstimate} />
                </Field>
                <Field label="Created">
                  <p className="text-sm text-muted-foreground h-9 flex items-center">
                    {task.created_by_name || 'Unknown'} · {timeAgo(task.created_at)}
                  </p>
                </Field>
              </div>

              <Field label="Description">
                {canEdit ? (
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={saveDescription}
                    placeholder="Add context, acceptance criteria, links…" className="min-h-[96px]" />
                ) : (
                  <p className="text-sm whitespace-pre-wrap text-foreground/90">{task.description || <span className="text-muted-foreground">No description</span>}</p>
                )}
              </Field>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <CheckSquare size={12} /> Checklist
                  </Label>
                  {checklist.length > 0 && <span className="text-xs text-muted-foreground">{doneCount}/{checklist.length}</span>}
                </div>
                {checklist.length > 0 && <ProgressBar value={(doneCount / checklist.length) * 100} barClass="bg-emerald-500" />}
                <div className="space-y-1">
                  {checklist.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 group py-1">
                      <Checkbox checked={c.done} disabled={!canUpdate} onCheckedChange={() => toggleItem(c.id)} />
                      <span className={`text-sm flex-1 ${c.done ? 'line-through text-muted-foreground' : ''}`}>{c.text}</span>
                      {canUpdate && (
                        <button onClick={() => removeItem(c.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" aria-label="Remove item">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canUpdate && (
                  <form onSubmit={addItem} className="flex gap-2">
                    <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a step…" className="h-8 text-sm" data-testid="checklist-input" />
                    <Button type="submit" size="sm" variant="secondary" className="h-8"><Plus size={14} /></Button>
                  </form>
                )}
              </div>

              <Tabs defaultValue="comments">
                <TabsList className="bg-secondary/50">
                  <TabsTrigger value="comments" className="gap-1"><MessageSquare size={13} /> Comments ({comments.length})</TabsTrigger>
                  <TabsTrigger value="files" className="gap-1"><Paperclip size={13} /> Files ({files.length})</TabsTrigger>
                  <TabsTrigger value="activity" className="gap-1"><History size={13} /> Activity</TabsTrigger>
                </TabsList>

                <TabsContent value="comments" className="space-y-3 mt-3">
                  {comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet. Ask a question or share an update.</p>}
                  {comments.map((c) => (
                    <div key={c.comment_id} className="flex gap-2.5 group">
                      <UserAvatar name={c.user_name} />
                      <div className="flex-1 min-w-0 bg-secondary/30 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{c.user_name}</span>
                          <span className="text-[10px] text-muted-foreground">{timeAgo(c.created_at)}</span>
                          {(c.user_id === user?.user_id || user?.role === 'admin') && (
                            <button onClick={() => deleteComment(c.comment_id)} className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" aria-label="Delete comment">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words">{c.content}</p>
                      </div>
                    </div>
                  ))}
                  <form onSubmit={postComment} className="relative">
                    {mentionOptions.length > 0 && (
                      <div className="absolute bottom-full mb-1 left-0 w-56 rounded-md border border-border bg-popover shadow-lg z-10 py-1">
                        {mentionOptions.map((u) => (
                          <button type="button" key={u.user_id} onClick={() => insertMention(u.name)}
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary flex items-center gap-2">
                            <UserAvatar name={u.name} className="h-5 w-5" textClass="text-[8px]" /> {u.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                      placeholder="Write a comment… use @ to mention a teammate"
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment(e); }}
                      className="pr-12 text-sm" data-testid="task-comment-input" />
                    <Button type="submit" size="icon" disabled={posting || !comment.trim()} className="absolute right-2 bottom-2 h-7 w-7">
                      {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    </Button>
                  </form>
                  <p className="text-[10px] text-muted-foreground">Ctrl/⌘ + Enter to send</p>
                </TabsContent>

                <TabsContent value="files" className="space-y-2 mt-3">
                  <input ref={fileInput} type="file" className="hidden" onChange={upload} />
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => fileInput.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Attach file
                  </Button>
                  {files.length === 0 && <p className="text-sm text-muted-foreground">No attachments.</p>}
                  {files.map((f) => (
                    <div key={f.file_id} className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2 group">
                      <Paperclip size={14} className="text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{f.original_name}</p>
                        <p className="text-[10px] text-muted-foreground">{formatBytes(f.size)} · {f.uploaded_by_name} · {timeAgo(f.created_at)}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => filesApi.download(f).catch((err) => toast.error(errorMessage(err)))} aria-label="Download">
                        <Download size={13} />
                      </Button>
                      {(f.uploaded_by === user?.user_id || canEdit) && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeFile(f)} aria-label="Delete file">
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="activity" className="mt-3">
                  {activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activity recorded.</p>
                  ) : (
                    <ol className="space-y-2.5 border-l border-border/60 pl-4">
                      {activity.map((a) => (
                        <li key={a.activity_id} className="text-sm relative">
                          <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-primary/70" />
                          <span className="font-medium">{a.user_name}</span>{' '}
                          <span className="text-muted-foreground">{a.action}{a.details ? ` (${a.details})` : ''}</span>
                          <span className="block text-[10px] text-muted-foreground">{timeAgo(a.created_at)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            {canEdit && (
              <div className="px-6 py-3 border-t border-border/40 flex justify-between items-center">
                <span className="text-[11px] text-muted-foreground">Changes save automatically</span>
                <Button variant="ghost" size="sm" className="text-destructive gap-1" onClick={deleteTask} data-testid="task-delete-btn">
                  <Trash2 size={13} /> Delete task
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
