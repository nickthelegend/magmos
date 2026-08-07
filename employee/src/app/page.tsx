import { PrivatePayoutsCard } from "@/components/private-payouts-card";
import { EmployeePortalScreen } from "@/components/dashboard/sweem/employee-portal-screen";

export default function PortalPage() {
  return (
    <>
      <EmployeePortalScreen />
      <div className="mx-auto w-full max-w-5xl px-4 pb-10">
        <PrivatePayoutsCard />
      </div>
    </>
  );
}
