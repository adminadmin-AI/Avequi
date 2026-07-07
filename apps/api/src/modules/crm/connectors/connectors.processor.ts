import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { CRM_LEADS_QUEUE, MetaLeadJobData, MlQuestionJobData } from './connectors.types';
import { MetaLeadsService } from './meta-leads.service';
import { MercadoLivreService } from './mercadolivre.service';

/** Fila dos conectores de captação (F1.4/F1.5) — retry exponencial no add */
@Injectable()
@Processor(CRM_LEADS_QUEUE)
export class ConnectorsProcessor {
  private readonly logger = new Logger(ConnectorsProcessor.name);

  constructor(
    private readonly metaLeads: MetaLeadsService,
    private readonly ml: MercadoLivreService,
  ) {}

  @Process('meta-lead')
  async handleMetaLead(job: Job<MetaLeadJobData>): Promise<void> {
    this.logger.log(`[job:${job.id}] leadgen ${job.data.value?.leadgen_id}`);
    await this.metaLeads.processLeadgen(job.data.value ?? {});
  }

  @Process('ml-question')
  async handleMlQuestion(job: Job<MlQuestionJobData>): Promise<void> {
    this.logger.log(`[job:${job.id}] pergunta ML ${job.data.resource}`);
    await this.ml.processQuestion(job.data.resource);
  }
}
