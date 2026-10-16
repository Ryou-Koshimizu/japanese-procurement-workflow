import '@fontsource-variable/noto-sans-jp';
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '備品発注ワークフロー',
  description:
    '仕入先サイトからカタログを取り込み、店舗の発注依頼→本社の承認と見積→店舗の承諾→発注確定と金額の通知までを、権限と監査ログつきで処理する業務システム',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
