import type { Role } from '@zakupki/shared';

export function cabinetPath(role: Role): string {
  switch (role) {
    case 'supplier':
      return '/app';
    case 'security':
      return '/sb';
    case 'manager':
    case 'admin':
      return '/admin';
    default:
      return '/';
  }
}

export function roleLabel(role: Role): string {
  switch (role) {
    case 'admin':
      return 'Администратор';
    case 'manager':
      return 'Менеджер закупок';
    case 'security':
      return 'Служба безопасности';
    case 'supplier':
      return 'Поставщик';
  }
}
