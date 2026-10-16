import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/noto-sans-jp';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { liquidScript } from '../src/ui/liquid';

export const metadata: Metadata = {
  title: '備品発注ワークフロー',
  description:
    '仕入先サイトからカタログを取り込み、店舗の発注依頼→本社の承認と見積→店舗の承諾→発注確定と金額の通知までを、権限と監査ログつきで処理する業務システム',
};

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ecf2f6' },
    { media: '(prefers-color-scheme: dark)', color: '#050811' },
  ],
};

// Applies the saved theme before the first paint, so a dark choice never
// flashes light. "auto" (nothing saved) follows the system setting in CSS.
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* The moving light behind the glass (src/ui/liquid.ts). */}
        <canvas id="lg-bg" aria-hidden="true" suppressHydrationWarning />
        <script dangerouslySetInnerHTML={{ __html: liquidScript }} />
        {children}
      </body>
    </html>
  );
}
