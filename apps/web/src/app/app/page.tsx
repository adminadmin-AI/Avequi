'use client';

import { Workspace } from '@/components/workspace/workspace';

/**
 * Home = Workspace por papel (F0 do épico Workspace Inteligente).
 *
 * A composição não mora mais aqui: o que cada perfil vê vem dos templates
 * (components/workspace/templates.ts) filtrados pela permissão efetiva do
 * usuário. Widget novo = registry + template, sem tocar nesta página.
 */
export default function HomePage() {
  return <Workspace />;
}
