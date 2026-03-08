import { useState, useEffect } from 'react';
import { dashboardApi } from '@/services/api';
import type { DashboardData, Card } from '@/types';
import { Briefcase, Clock, AlertTriangle, BarChart3, Calendar, MapPin } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';

const priorityColors: Record<string, string> = {
  critical: 'text-red-600 bg-red-50',
  high: 'text-orange-600 bg-orange-50',
  medium: 'text-blue-600 bg-blue-50',
  low: 'text-gray-600 bg-gray-50',
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi
      .getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="skeleton h-72 rounded-xl" />
          <div className="skeleton h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Failed to load dashboard data.</p>
      </div>
    );
  }

  const maxStageCount = Math.max(...data.byStage.map((s) => s.count), 1);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your job search pipeline</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Briefcase size={20} />}
          label="Active Applications"
          value={data.activeCount}
          color="bg-primary-50 text-primary-600"
        />
        <StatCard
          icon={<BarChart3 size={20} />}
          label="Total Stages"
          value={data.byStage.length}
          color="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          icon={<Clock size={20} />}
          label="Upcoming Follow-ups"
          value={data.upcomingFollowUps.length}
          color="bg-amber-50 text-amber-600"
        />
        <StatCard
          icon={<AlertTriangle size={20} />}
          label="Stale Applications"
          value={data.staleApplications.length}
          color="bg-red-50 text-red-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Applications by Stage - Bar Chart */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Applications by Stage</h2>
          <div className="space-y-3">
            {data.byStage.map((stage) => (
              <div key={stage.name} className="flex items-center gap-3">
                <span className="w-28 text-sm text-gray-600 truncate shrink-0">{stage.name}</span>
                <div className="flex-1 h-7 bg-gray-100 rounded-md overflow-hidden">
                  <div
                    className="h-full bg-primary-500 rounded-md transition-all duration-500 flex items-center justify-end pr-2"
                    style={{ width: `${Math.max((stage.count / maxStageCount) * 100, 8)}%` }}
                  >
                    <span className="text-xs font-medium text-white">{stage.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {data.byStage.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
          )}
        </div>

        {/* Upcoming Follow-ups */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Upcoming Follow-ups</h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.upcomingFollowUps.map((card) => (
              <FollowUpItem key={card.id} card={card} />
            ))}
            {data.upcomingFollowUps.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No upcoming follow-ups</p>
            )}
          </div>
        </div>
      </div>

      {/* Stale Applications */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Stale Applications
          <span className="ml-2 text-xs font-normal text-gray-400">No activity in 7+ days</span>
        </h2>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {data.staleApplications.map((card) => (
            <StaleItem key={card.id} card={card} />
          ))}
          {data.staleApplications.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">All applications are active</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className={`inline-flex items-center justify-center rounded-lg p-2 ${color}`}>
        {icon}
      </div>
      <p className="mt-3 text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

function FollowUpItem({ card }: { card: Card }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3">
      <Calendar size={16} className="text-amber-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{card.companyName}</p>
        <p className="text-xs text-gray-500 truncate">{card.roleTitle}</p>
      </div>
      <div className="text-right shrink-0">
        {card.nextFollowupDate && (
          <p className="text-xs text-amber-600 font-medium">
            {formatDistanceToNow(parseISO(card.nextFollowupDate), { addSuffix: true })}
          </p>
        )}
        <span className={`inline-block mt-0.5 text-xs px-1.5 py-0.5 rounded ${priorityColors[card.priority]}`}>
          {card.priority}
        </span>
      </div>
    </div>
  );
}

function StaleItem({ card }: { card: Card }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3">
      <AlertTriangle size={16} className="text-red-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{card.companyName}</p>
        <p className="text-xs text-gray-500 truncate">{card.roleTitle}</p>
      </div>
      <div className="text-right shrink-0">
        {card.lastInteractionDate && (
          <p className="text-xs text-gray-500">
            Last activity {formatDistanceToNow(parseISO(card.lastInteractionDate), { addSuffix: true })}
          </p>
        )}
        {card.location && (
          <p className="text-xs text-gray-400 flex items-center gap-1 justify-end mt-0.5">
            <MapPin size={10} /> {card.location}
          </p>
        )}
      </div>
    </div>
  );
}
