import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { CandidateView } from './views/CandidateView';
import { Candidates } from './views/Candidates';
import { CandidateProfile } from './views/CandidateProfile';
import { Console } from './views/Console';
import { Scorecard } from './views/Scorecard';
import { Settings } from './views/Settings';

export function App() {
  return (
    <Routes>
      {/* Standalone: no interviewer layout, no /api/me or /api/kit. */}
      <Route path="/c/:token" element={<CandidateView />} />
      <Route path="/candidates/:id/scorecard" element={<Scorecard />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Candidates />} />
        <Route path="/candidates/:id" element={<CandidateProfile />} />
        <Route path="/sessions/:id" element={<Console />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
