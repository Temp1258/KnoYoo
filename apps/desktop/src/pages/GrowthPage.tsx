import ContributionsCard from "../components/Growth/ContributionsCard";
import WeekReportCard from "../components/Growth/WeekReport";

export default function GrowthPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-[28px] font-bold tracking-tight m-0">我的成长</h1>

      <WeekReportCard />

      <ContributionsCard />
    </div>
  );
}
