import { Link2, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">
              jayscooks
            </h1>
            <p className="text-lg text-slate-400">
              Twitter værktøjer til autorisation og tweet management
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Link
              to="/generator"
              className="group bg-zinc-950/80 backdrop-blur-xl border border-zinc-800 hover:border-blue-500/50 rounded-2xl p-8 transition-all duration-300 shadow-2xl hover:shadow-blue-500/10"
            >
              <div className="flex items-center justify-center w-14 h-14 bg-blue-500/10 rounded-xl mb-6 group-hover:bg-blue-500/20 transition">
                <Link2 className="w-7 h-7 text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3 tracking-tight">
                Link Generator
              </h2>
              <p className="text-slate-400 leading-relaxed">
                Generer autorisation links med custom preview cards til Twitter DMs.
                Konfigurer Twitter API keys og opret branded short links.
              </p>
              <div className="mt-6 text-blue-400 font-semibold flex items-center gap-2 group-hover:gap-3 transition-all">
                Åbn Generator
                <span>→</span>
              </div>
            </Link>

            <Link
              to="/dashboard"
              className="group bg-zinc-950/80 backdrop-blur-xl border border-zinc-800 hover:border-green-500/50 rounded-2xl p-8 transition-all duration-300 shadow-2xl hover:shadow-green-500/10"
            >
              <div className="flex items-center justify-center w-14 h-14 bg-green-500/10 rounded-xl mb-6 group-hover:bg-green-500/20 transition">
                <Users className="w-7 h-7 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3 tracking-tight">
                Dashboard
              </h2>
              <p className="text-slate-400 leading-relaxed">
                Administrer autoriserede brugere og post tweets.
                Se alle brugere der har givet adgang til din app.
              </p>
              <div className="mt-6 text-green-400 font-semibold flex items-center gap-2 group-hover:gap-3 transition-all">
                Åbn Dashboard
                <span>→</span>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
