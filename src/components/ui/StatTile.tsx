import Panel from "@/components/ui/Panel";
import Eyebrow from "@/components/ui/Eyebrow";

// Shared small stat card — Home's stats strip (H1.6e) and the Profile hub
// both show the same Library/Wishlist/Rated/best-genre numbers.
export default function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Panel className="flex-1 min-w-[7.5rem] px-4 py-3">
      <div className="flex items-center gap-1.5 text-text-secondary mb-1">
        {icon}
        <Eyebrow tone="secondary">{label}</Eyebrow>
      </div>
      <div className="font-serif text-serif-lg text-text-primary">{value}</div>
    </Panel>
  );
}
