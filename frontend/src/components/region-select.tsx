import { useRegions } from "@/hooks/use-regions";

export function RegionSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (regionId: string) => void;
  id?: string;
}) {
  const { data: regions } = useRegions();

  return (
    <select
      id={id}
      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select area...</option>
      {regions?.map((region) => (
        <option key={region.id} value={region.id}>
          {region.name} ({region.type})
        </option>
      ))}
    </select>
  );
}
