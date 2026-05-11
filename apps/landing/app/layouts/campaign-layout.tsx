import { Outlet } from 'react-router';

export default function CampaignLayout() {
  return (
    <>
      <header className="flex items-center px-6 py-4">
        <a href="/" aria-label="SureWaka home">
          <span className="text-xl font-bold text-primary">SureWaka</span>
        </a>
      </header>
      <Outlet />
    </>
  );
}
