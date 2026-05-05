import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
  {
    path: 'trades',
    loadComponent: () => import('./pages/trades/trades.component').then(m => m.TradesComponent),
  },
  {
    path: 'tax',
    loadComponent: () => import('./pages/tax/tax.component').then(m => m.TaxComponent),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent),
  },
  { path: '**', redirectTo: '' },
];
