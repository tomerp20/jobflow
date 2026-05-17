import { useState, useEffect } from 'react';
import { Settings, Mail, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useLocation } from 'react-router-dom';
import { gmailApi } from '@/services/api';
import type { GmailStatusData, SyncSummary } from '@/services/api';

function SyncResultPanel({ result }: { result: SyncSummary }) {
  const pl = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
  const hasActions = result.receipts > 0 || result.moved > 0 || result.ambiguous > 0 || result.lowConfidence > 0;

  return (
    <div className="text-sm space-y-1">
      <p className="font-medium text-gray-800">
        ✦ Sync complete —{' '}
        {result.scanned === 0
          ? 'no new emails'
          : `${result.scanned} email${result.scanned !== 1 ? 's' : ''} scanned`}
      </p>
      {result.scanned > 0 && !hasActions && (
        <p className="pl-4 text-gray-500">All clear, nothing to action</p>
      )}
      {result.receipts > 0 && (
        <p className="pl-4 text-emerald-700">
          ✚ {pl(result.receipts, 'new application created', 'new applications created')}
        </p>
      )}
      {result.moved > 0 && (
        <p className="pl-4 text-gray-500">✕ {result.moved} moved to Rejected</p>
      )}
      {result.ambiguous > 0 && (
        <p className="pl-4 text-amber-700">
          ⚠ {pl(result.ambiguous, 'email needs your review', 'emails need your review')}
        </p>
      )}
      {result.lowConfidence > 0 && (
        <p className="pl-4 text-amber-700">
          ⚠ {pl(result.lowConfidence, 'low confidence match', 'low confidence matches')}
        </p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [gmailStatus, setGmailStatus] = useState<GmailStatusData>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    gmailApi
      .getStatus()
      .then((data) => setGmailStatus(data))
      .catch(() => setGmailStatus({ connected: false }))
      .finally(() => setLoading(false));
  }, [location.search]);

  const isConnectedValid =
    gmailStatus.connected === true && gmailStatus.isValid === true;
  const isConnectedInvalid =
    gmailStatus.connected === true && gmailStatus.isValid === false;

  async function handleConnect() {
    const url = await gmailApi.getAuthUrl();
    window.location.href = url;
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const result = await gmailApi.sync();
      setSyncResult(result);
      const updated = await gmailApi.getStatus();
      setGmailStatus(updated);
    } catch {
      setSyncError('Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Gmail? This will stop automatic rejection detection.')) return;
    try {
      await gmailApi.disconnect();
      setGmailStatus({ connected: false });
      setSyncResult(null);
      setSyncError(null);
    } catch {
      setSyncError('Failed to disconnect. Please try again.');
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Settings size={22} className="text-primary-600" />
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
      </div>

      {/* Gmail Integration card */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Mail size={20} className="text-gray-500 shrink-0" />
          <h2 className="text-base font-semibold text-gray-900">Gmail Integration</h2>
          {isConnectedValid && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <CheckCircle size={11} />
              Connected
            </span>
          )}
        </div>

        {loading && (
          <div className="skeleton h-10 rounded-lg" />
        )}

        {!loading && (
          <>
            {/* State 3: connected but token revoked */}
            {isConnectedInvalid && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle size={16} className="shrink-0 text-amber-500" />
                Gmail connection lost — please reconnect your account.
              </div>
            )}

            {/* State 1: disconnected */}
            {!gmailStatus.connected && (
              <>
                <p className="text-sm text-gray-500">
                  Connect your Gmail account to automatically detect rejection emails and update your board.
                </p>
                <button
                  onClick={handleConnect}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition"
                >
                  <Mail size={15} />
                  Connect Gmail
                </button>
              </>
            )}

            {/* State 2: connected and valid */}
            {isConnectedValid && gmailStatus.connected && (
              <>
                <div className="text-sm text-gray-600">
                  <span className="font-medium text-gray-800">{gmailStatus.email}</span>
                </div>
                <div className="text-sm text-gray-500">
                  <span className="font-medium text-gray-700">Last synced:</span>{' '}
                  {gmailStatus.lastSyncAt
                    ? formatDistanceToNow(parseISO(gmailStatus.lastSyncAt), { addSuffix: true })
                    : 'Never synced yet'}
                </div>
                {syncResult && <SyncResultPanel result={syncResult} />}
                {syncError && (
                  <p className="text-sm text-red-600">{syncError}</p>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition disabled:opacity-60"
                  >
                    <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? 'Syncing…' : 'Sync Now'}
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-red-300 hover:text-red-600 transition"
                  >
                    Disconnect
                  </button>
                </div>
              </>
            )}

            {/* State 3 reconnect button */}
            {isConnectedInvalid && (
              <button
                onClick={handleConnect}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition"
              >
                <Mail size={15} />
                Reconnect Gmail
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
