import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/noto-sans-jp';
import '@fontsource/dela-gothic-one';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { motionScript } from '../src/ui/motion';

export const metadata: Metadata = {
  title: '備品発注ワークフロー',
  description:
    'A社の拠点の依頼から、B社のヒアリング・メーカーの相見積・見積書・合意・発注・納期のお知らせまでを、権限と監査ログつきで処理する業務システム',
};

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fff4e0' },
    { media: '(prefers-color-scheme: dark)', color: '#16141c' },
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
        {/* Scroll state and the reveal of blocks below the first screen. */}
        <script dangerouslySetInnerHTML={{ __html: motionScript }} />
        {children}
      </body>
    </html>
  );
}
