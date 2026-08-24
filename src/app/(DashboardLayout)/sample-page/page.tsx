"use client";
import Typography from "@mui/material/Typography";
import PageContainer from "@/app/components/container/PageContainer";
import DashboardCard from "@/app/components/shared/DashboardCard";
import Breadcrumb from "../layout/shared/breadcrumb/Breadcrumb";

const BCrumb = [
  {
    to: "/",
    title: "Home",
  },
  {
    title: "SamplePage",
  },
];

export default function SamplePage() {
  return (
    <PageContainer title="Sample Page" description="this is Sample page">
      {/* breadcrumb */}
      <Breadcrumb title="SamplePage" items={BCrumb} />
      {/* end breadcrumb */}
      <DashboardCard title="Sample Page">
        <Typography>This is a sample2 page</Typography>
      </DashboardCard>
    </PageContainer>
  );
}
