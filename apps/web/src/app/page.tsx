'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Raiz do app (app.avecchi.ai/) — não existe home pública: quem já tem
 * sessão segue para o app; quem não tem, para o login. A vitrine do
 * produto é a landing (avecchi.ai).
 */
export default function HomePage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    router.replace(isAuthenticated ? '/app' : '/login');
  }, [router, isAuthenticated]);

  // Fundo preto durante o replace — evita flash branco antes do login
  return <div className="min-h-screen bg-black" aria-hidden />;
}
