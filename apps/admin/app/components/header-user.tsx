import { useNavigate } from 'react-router';
import { BadgeCheck, Bell, LogOut, Settings } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Button } from '~/components/ui/button';
import { useAuth, signOut } from '~/hooks/use-auth';
import { useProfile } from '~/hooks/use-profile';

export function HeaderUser() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  if (!user) return null;

  const email = user.email ?? '';
  const name =
    profile?.name ??
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    email.split('@')[0] ??
    'Admin';
  const avatar = profile?.avatarUrl ?? user.user_metadata?.avatar_url ?? '';

  const initials = name
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="relative h-8 w-8 rounded-md p-0">
          <Avatar className="h-8 w-8 rounded-md">
            <AvatarImage src={avatar} alt={name} className="rounded-md" />
            <AvatarFallback className="rounded-md">{initials || 'AD'}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" sideOffset={8}>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{name}</p>
            <p className="text-xs leading-none text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => navigate('/settings/profile')}>
            <BadgeCheck className="mr-2 h-4 w-4" />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/settings')}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/settings/profile')}>
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
