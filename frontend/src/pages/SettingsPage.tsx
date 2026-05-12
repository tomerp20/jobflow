import { useState, useEffect } from 'react';
import { Settings, Mail, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { gmailApi } from '@/services/api';

type GmailStatus =
  | { connected: false }
  | { connected: true; isValid: true; email: string; lastSyncAt: string | null }
  | { connected: true; isValid: false; email: string; lastSyncAt: string | null };

export default function SettingsPage() {
  const [gmailStatus, setGmailStatus] = useState<GmailStatus>({ connected: false });
  const [syncResult] = useState('');

  useEffect(() => {
    gmailApi
      .getStatus()
      .then((data) => setGmailStatus(data))
      .catch(() => setGmailStatus({ connected: false }));
  }, []);

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
          {gmailStatus.connected && gmailStatus.isValid && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <CheckCircle size={11} />
              Connected
            </span>
          )}
        </div>

        {/* State 3: connected but token revoked */}
        {gmailStatus.connected && !gmailStatus.isValid && (
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
              onClick={() => {
                // TODO: wire OAuth
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition"
            >
              <Mail size={15} />
              Connect Gmail
            </button>
          </>
        )}

        {/* State 2: connected and valid */}
        {gmailStatus.connected && gmailStatus.isValid && (
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
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  // TODO: wire sync
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition"
              >
                <RefreshCw size={14} />
                Sync Now
              </button>
              <button
                onClick={() => {
                  // TODO: wire disconnect
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-red-300 hover:text-red-600 transition"
              >
                Disconnect
              </button>
            </div>
            {syncResult && (
              <p className="text-sm text-gray-600">{syncResult}</p>
            )}
          </>
        )}

        {/* State 3 reconnect button */}
        {gmailStatus.connected && !gmailStatus.isValid && (
          <button
            onClick={() => {
              // TODO: wire OAuth
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition"
          >
            <Mail size={15} />
            Reconnect Gmail
          </button>
        )}
      </section>
    </div>
  );
}
