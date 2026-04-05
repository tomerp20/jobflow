import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Briefcase, LayoutDashboard, Columns3, CheckSquare, LogOut, User } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const navItems = [
    { to: '/', label: 'Board', icon: Columns3 },
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  ];

  return (
    <nav className="bg-white border-b border-gray-200 px-4 h-14 flex items-center justify-between shrink-0">
      {/* Left: Logo + Nav */}
      <div className="flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2 text-primary-600 font-bold text-lg">
          <Briefcase size={22} />
          <span>JobFlow</span>
        </Link>
        <div className="flex items-center gap-1">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Right: User menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-700">
            <User size={14} />
          </div>
          <span className="hidden sm:inline font-medium">{user?.name}</span>
        </button>

        {showMenu && (
          <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg z-50">
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
            <button
              onClick={() => {
                setShowMenu(false);
                logout();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
