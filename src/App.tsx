import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import LinkGenerator from './pages/LinkGenerator';
import Dashboard from './pages/Dashboard';
import PasswordGate from './components/PasswordGate';

function App() {
  return (
    <PasswordGate>
      <Router>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/generator" element={<LinkGenerator />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </Router>
    </PasswordGate>
  );
}

export default App;
