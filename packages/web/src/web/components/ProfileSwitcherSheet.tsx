import { useState } from 'react';
import { Check } from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { Sheet } from './ui/Sheet';
import { Row } from './ui/GroupedList';

interface ProfileSwitcherSheetProps {
  onManageLocations: () => void;
  onSettings: () => void;
}

/** Apple-ID-style avatar button, top-right on every screen. */
export function ProfileSwitcherButton({ onManageLocations, onSettings }: ProfileSwitcherSheetProps) {
  const [open, setOpen] = useState(false);
  const { activeProfile, allRadiologists, locations, switchRadiologist } = useOrg();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Switch profile or location"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
        style={{ background: 'var(--rd-accent)' }}
      >
        {activeProfile?.initials ?? '—'}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Switch profile">
        <div className="space-y-4">
          <button type="button" onClick={() => { setOpen(false); onSettings(); }} className="min-h-11 w-full rounded-[10px] bg-rd-surface-2 px-3 text-left text-[15px] font-medium text-rd-label-primary">
            Settings
          </button>
          <div>
            <p className="mb-1.5 px-1 text-[13px] text-rd-label-secondary">Radiologists</p>
            <div className="overflow-hidden rounded-[16px] bg-rd-bg [&>*+*]:border-t [&>*+*]:border-rd-separator">
              {allRadiologists.map((profile) => (
                <Row
                  key={profile.id}
                  onClick={async () => {
                    await switchRadiologist(profile.id);
                    setOpen(false);
                  }}
                  trailing={activeProfile?.id === profile.id ? <Check className="size-5 text-rd-accent" /> : undefined}
                >
                  {profile.name}
                </Row>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 px-1 text-[13px] text-rd-label-secondary">Locations</p>
            <div className="overflow-hidden rounded-[16px] bg-rd-bg [&>*+*]:border-t [&>*+*]:border-rd-separator">
              {locations.map((location) => (
                <Row key={location.id} footnote={location.city ?? undefined}>
                  {location.name}
                </Row>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onManageLocations();
            }}
            className="min-h-11 w-full text-center text-[15px] font-medium text-rd-accent"
          >
            Manage profiles and locations
          </button>
        </div>
      </Sheet>
    </>
  );
}
