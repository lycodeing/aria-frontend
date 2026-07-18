<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import type { Recordable } from '@vben/types';

import { computed, ref } from 'vue';

import { AuthenticationForgetPassword, z } from '@vben/common-ui';
import { $t } from '@vben/locales';

import { message } from 'ant-design-vue';

import { authClient } from '#/api/request';

defineOptions({ name: 'ForgetPassword' });

const loading = ref(false);

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: 'example@example.com',
      },
      fieldName: 'email',
      label: $t('authentication.email'),
      rules: z
        .string()
        .min(1, { message: $t('authentication.emailTip') })
        .email($t('authentication.emailValidErrorTip')),
    },
  ];
});

/**
 * 找回密码（座席端）。
 * 后端约定：POST /auth/api/v1/auth/reset-password
 *
 * 成功后不重置 loading，避免用户重复提交（按钮保持禁用状态）。
 */
async function handleSubmit(value: Recordable<any>) {
  loading.value = true;
  try {
    await authClient.post('/auth/reset-password', { email: value.email });
    message.success(
      $t('authentication.resetPasswordSuccess') || '重置邮件已发送，请查收',
    );
    // 成功后保持 loading=true，防止重复提交；用户需刷新或返回登录页才能再操作
  } catch {
    message.error(
      $t('authentication.resetPasswordFailed') || '找回密码失败，请稍后重试',
    );
    loading.value = false;
  }
}
</script>

<template>
  <AuthenticationForgetPassword
    :form-schema="formSchema"
    :loading="loading"
    @submit="handleSubmit"
  />
</template>
