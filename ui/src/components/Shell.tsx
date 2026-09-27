import { Settings as SettingsIcon, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { IS_MOCK } from '../api/client';
import { useKit, useMe } from '../api/hooks';

export function Shell() {
  const me = useMe();
  const kit = useKit();
  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center gap-6 px-4 py-2">
          <NavLink to="/" className="text-base font-semibold tracking-tight">
            talent-os
          </NavLink>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/" end className={({ isActive }) => `btn btn-sm border-transparent ${isActive ? 'bg-slate-100' : ''}`}>
              <Users size={14} /> Candidates
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => `btn btn-sm border-transparent ${isActive ? 'bg-slate-100' : ''}`}>
              <SettingsIcon size={14} /> Settings
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            {IS_MOCK && <span className="chip bg-amber-100 text-amber-800">MOCK</span>}
            {kit.data && (
              <span>
                {kit.data.title} · v{kit.data.version}
              </span>
            )}
            {me.data && (
              <span>
                {me.data.org.name} · {me.data.email}
              </span>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
