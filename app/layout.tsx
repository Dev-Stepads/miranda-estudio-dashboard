import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Miranda Studio — Dashboard',
  description: 'Dashboard consolidado de vendas, e-commerce e marketing da Miranda Studio',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body suppressHydrationWarning className="bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 antialiased transition-colors">
        {children}
      </body>
    </html>
  );
}
