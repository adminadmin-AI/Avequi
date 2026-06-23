'use client';

import Link from 'next/link';
import { Package, Users, Factory, ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';

const SHORTCUTS = [
  { href: '/app/products', label: 'Produtos', description: 'Catálogo e preços', icon: Package },
  { href: '/app/customers', label: 'Clientes', description: 'Cadastro de clientes', icon: Users },
  { href: '/app/suppliers', label: 'Fornecedores', description: 'Cadastro de fornecedores', icon: Factory },
];

export default function AppHome() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] ?? '';

  return (
    <div>
      <PageHeader
        title={`Bem-vindo${firstName ? `, ${firstName}` : ''}`}
        description="Selecione um módulo para começar."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SHORTCUTS.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="group transition-shadow duration-flow hover:shadow-md">
              <CardContent className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon size={22} />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{label}</p>
                  <p className="text-sm text-slate-500">{description}</p>
                </div>
                <ArrowRight
                  size={18}
                  className="text-slate-300 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-brand-600"
                />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
