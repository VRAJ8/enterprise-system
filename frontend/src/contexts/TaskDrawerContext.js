import React, { createContext, useCallback, useContext, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const TaskDrawerContext = createContext(null);

/**
 * Opens tasks in a side drawer from anywhere. The open task lives in the URL (?task=ID),
 * so notification links and shared URLs open straight to the task.
 * `version` bumps whenever a task changes so lists can refetch.
 */
export function TaskDrawerProvider({ children }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const taskId = searchParams.get('task');

  const openTask = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('task', id);
      return next;
    });
  }, [setSearchParams]);

  const closeTask = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('task');
      return next;
    });
  }, [setSearchParams]);

  const notifyChanged = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <TaskDrawerContext.Provider value={{ taskId, openTask, closeTask, version, notifyChanged }}>
      {children}
    </TaskDrawerContext.Provider>
  );
}

export const useTaskDrawer = () => {
  const ctx = useContext(TaskDrawerContext);
  if (!ctx) throw new Error('useTaskDrawer must be inside TaskDrawerProvider');
  return ctx;
};
