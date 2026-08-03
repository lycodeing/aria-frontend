<script lang="ts" setup>
import type { CsatOverviewData } from '#/api/csat';
import type { AgentWorkloadItem, DashboardOverviewData } from '#/api/dashboard';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Card, Col, Row, Spin } from 'ant-design-vue';

import {
  getMyCsatOverviewApi,
  getMyOverviewApi,
  getMyWorkloadApi,
} from '#/api/dashboard';

import AvgHandleTimeCard from '../analytics/avg-handle-time-card.vue';
import CsatStatCards from '../analytics/csat-stat-cards.vue';

const loading = ref(true);
const overview = ref<DashboardOverviewData>();
const workload = ref<AgentWorkloadItem>();
const csatOverview = ref<CsatOverviewData>({
  csatAvgScore: 0,
  csatResponseRate: 0,
  csatRatedCount: 0,
});

onMounted(async () => {
  try {
    const [ov, wl, csat] = await Promise.all([
      getMyOverviewApi(),
      getMyWorkloadApi(),
      getMyCsatOverviewApi(),
    ]);
    overview.value = ov;
    workload.value = wl;
    csatOverview.value = csat;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <Page>
    <Spin :spinning="loading">
      <Row :gutter="16">
        <Col :span="8">
          <Card title="今日接待">
            <div style="font-size: 32px; font-weight: 600">
              {{ overview?.todayConversationCount ?? 0 }}
            </div>
            <div style="color: #999">
              总会话数：{{ overview?.totalConversationCount ?? 0 }}
            </div>
          </Card>
        </Col>
        <Col :span="8">
          <Card title="进行中会话">
            <div style="font-size: 32px; font-weight: 600">
              {{ workload?.activeSessions ?? 0 }}
            </div>
            <div style="color: #999">
              总计接待：{{ workload?.totalSessions ?? 0 }}
            </div>
          </Card>
        </Col>
        <Col :span="8">
          <AvgHandleTimeCard :seconds="overview?.avgHandleSeconds ?? 0" />
        </Col>
      </Row>
      <Row :gutter="16" style="margin-top: 16px">
        <Col :span="24">
          <CsatStatCards
            :avg-score="csatOverview.csatAvgScore"
            :rated-count="csatOverview.csatRatedCount"
            :response-rate="csatOverview.csatResponseRate"
          />
        </Col>
      </Row>
      <Row :gutter="16" style="margin-top: 16px">
        <Col :span="8">
          <Card title="平均等待时长">
            <div style="font-size: 24px">
              {{ overview?.avgWaitSeconds ?? 0 }}s
            </div>
          </Card>
        </Col>
        <Col :span="8">
          <Card title="平均首响时长">
            <div style="font-size: 24px">
              {{ overview?.avgFirstReplySeconds ?? 0 }}s
            </div>
          </Card>
        </Col>
        <Col :span="8">
          <Card title="好评率">
            <div style="font-size: 24px">
              {{ ((csatOverview?.csatResponseRate ?? 0) * 100).toFixed(1) }}%
            </div>
          </Card>
        </Col>
      </Row>
    </Spin>
  </Page>
</template>
