import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Umbral · tu búsqueda inmobiliaria, siempre activa',
  description: 'Oportunidades inmobiliarias sin duplicados, con fuentes visibles y monitores que siguen buscando por vos.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es-AR"><body>{children}</body></html>;
}
