<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import type { Recordable } from '@vben/types';

import { computed } from 'vue';

import { AuthenticationCodeLogin, z } from '@vben/common-ui';
import { $t } from '@vben/locales';

import { message } from 'ant-design-vue';

import { smsLoginApi } from '#/api';
import { authClient } from '#/api/request';
import { useAuthStore } from '#/store';

defineOptions({ name: 'CodeLogin' });

const authStore = useAuthStore();
// loading 由 authStore.loginLoading 统一管理，本地不再维护独立状态
const CODE_LENGTH = 6;

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.mobile'),
      },
      fieldName: 'phoneNumber',
      label: $t('authentication.mobile'),
      rules: z
        .string()
        .min(1, { message: $t('authentication.mobileTip') })
        .refine((v) => /^\d{11}$/.test(v), {
          message: $t('authentication.mobileErrortip'),
        }),
    },
    {
      component: 'VbenPinInput',
      componentProps: {
        codeLength: CODE_LENGTH,
        createText: (countdown: number) => {
          const text =
            countdown > 0
              ? $t('authentication.sendText', [countdown])
              : $t('authentication.sendCode');
          return text;
        },
        placeholder: $t('authentication.code'),
      },
      fieldName: 'code',
      label: $t('authentication.code'),
      rules: z.string().length(CODE_LENGTH, {
        message: $t('authentication.codeTip', [CODE_LENGTH]),
      }),
    },
  ];
});

/**
 * 发送短信验证码（座席手机号验证码登录）。
 * 后端约定：POST /auth/api/v1/auth/sms/send
 */
async function sendCode(phone: string) {
  try {
    await authClient.post('/auth/sms/send', { phone });
    message.success($t('authentication.sendCodeSuccess') || '验证码已发送');
  } catch {
    message.error(
      $t('authentication.sendCodeFailed') || '验证码发送失败，请稍后重试',
    );
  }
}

/**
 * 验证码登录（座席端）。
 * 复用 authStore.authLogin 的完整登录后处理逻辑（存 token、拉用户信息、路由跳转），
 * 通过 customLoginFn 注入短信登录接口，避免重复实现。
 */
async function handleLogin(values: Recordable<any>) {
  await authStore.authLogin(
    { phone: values.phoneNumber, code: values.code },
    undefined,
    smsLoginApi,
  );
}
</script>

<template>
  <AuthenticationCodeLogin
    :form-schema="formSchema"
    :loading="authStore.loginLoading"
    @send-code="sendCode"
    @submit="handleLogin"
  />
</template>
