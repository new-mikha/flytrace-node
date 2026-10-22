/** The pages of the signed-in "My account" area, listed in the username menu of the top bar. */
export const ACCOUNT_SECTIONS = [
  { href: '/account', label: 'Profile', icon: 'fa-regular fa-id-card' },
  { href: '/account/email', label: 'Email', icon: 'fa-regular fa-envelope' },
  { href: '/account/password', label: 'Password', icon: 'fa-solid fa-key' },
  { href: '/account/2fa', label: 'Two-factor login', icon: 'fa-solid fa-shield-halved' },
  { href: '/account/personal-data', label: 'Personal data', icon: 'fa-solid fa-database' },
] as const;
