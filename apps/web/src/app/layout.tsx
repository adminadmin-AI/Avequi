import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: {
    default: 'Avecchi — Industrial ERP',
    template: '%s — Avecchi',
  },
  description:
    'Produção, estoque, compras, PCP, fiscal e financeiro em uma única plataforma.',
  // PWA (CRM V2.1 #568) — instalável no celular do vendedor; iOS exige isso p/ push
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Avecchi', statusBarStyle: 'default' },
  // icon explícito: com `icons` manual o Next 14 NÃO injeta o link do
  // icon.png por convenção de arquivo — sem esta linha a aba fica genérica
  icons: { icon: '/icon.png', apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#3D2CE6',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
