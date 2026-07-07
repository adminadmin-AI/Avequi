export const CRM_LEADS_QUEUE = 'CRM_LEADS_QUEUE';

export interface MetaLeadJobData {
  value: {
    leadgen_id?: string;
    page_id?: string;
    form_id?: string;
    ad_id?: string;
    adgroup_id?: string;
    campaign_id?: string;
  };
}

export interface MlQuestionJobData {
  resource: string; // ex: /questions/123456
}
