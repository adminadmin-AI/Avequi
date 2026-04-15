import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-slate-900">GDR ERP</h1>
        <p className="text-slate-500">Sistema de gestão integrada</p>
        <Link
          href="/login"
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Entrar no sistema
        </Link>
      </div>
    </main>
  );
}
