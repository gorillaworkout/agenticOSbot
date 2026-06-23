import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Agentic OS',
  description: 'AI Agent Platform',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'AgenticOS',
  },
};

export const viewport: Viewport = {
  themeColor: '#8b5cf6',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};
