'use client';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl mb-4">📡</div>
        <h1 className="text-2xl font-bold text-white mb-2">You&apos;re Offline</h1>
        <p className="text-zinc-400">Please check your internet connection and try again.</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
