import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Realty Agent',
  description: 'Agentic real-estate opportunity discovery'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
