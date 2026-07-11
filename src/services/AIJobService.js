const crypto = require('crypto');
const AIService = require('./AIService');

class AIJobService {
  constructor(redisClient) {
    this.redisClient = redisClient;
    
    this.inMemoryJobs = new Map();
    this.inMemoryQueue = [];
    this.isWorkerRunning = false;
    this.maxAttempts = 3;
  }

  /**
   * Enqueues a new AI classification job
   */
  async createJob(text) {
    const jobId = crypto.randomUUID();
    const jobData = {
      id: jobId,
      status: 'pending',
      text: text,
      result: null,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      error: null,
      alerted: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    };

    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.set(`ai_job:${jobId}`, JSON.stringify(jobData));
      await this.redisClient.lPush('queue:ai_jobs', jobId);
    } else {
      this.inMemoryJobs.set(jobId, jobData);
      this.inMemoryQueue.push(jobId);
    }

    console.log(`[AI Queue] Enqueued job: ${jobId} | Length of text: ${text.length}`);
    
    this.triggerWorker();
    return jobData;
  }

  /**
   * Fetches job status
   */
  async getJobStatus(jobId) {
    if (this.redisClient && this.redisClient.isOpen) {
      const data = await this.redisClient.get(`ai_job:${jobId}`);
      return data ? JSON.parse(data) : null;
    } else {
      return this.inMemoryJobs.get(jobId) || null;
    }
  }

  /**
   * Updates job data in storage
   */
  async updateJob(jobId, updates) {
    if (this.redisClient && this.redisClient.isOpen) {
      const data = await this.redisClient.get(`ai_job:${jobId}`);
      if (data) {
        const job = JSON.parse(data);
        const updatedJob = { ...job, ...updates };
        await this.redisClient.set(`ai_job:${jobId}`, JSON.stringify(updatedJob));
      }
    } else {
      const job = this.inMemoryJobs.get(jobId);
      if (job) {
        this.inMemoryJobs.set(jobId, { ...job, ...updates });
      }
    }
  }

  /**
   * Triggers the background worker loop
   */
  triggerWorker() {
    if (this.isWorkerRunning) return;
    this.isWorkerRunning = true;
    this._runWorker().catch(err => {
      console.error('[AI Worker Fatal] Thread crashed:', err);
      this.isWorkerRunning = false;
    });
  }

  /**
   * Background worker loop
   */
  async _runWorker() {
    while (true) {
      let jobId = null;
      if (this.redisClient && this.redisClient.isOpen) {
        jobId = await this.redisClient.rPop('queue:ai_jobs');
      } else {
        jobId = this.inMemoryQueue.shift();
      }

      if (!jobId) {
        this.isWorkerRunning = false;
        break;
      }

      const jobData = await this.getJobStatus(jobId);
      if (!jobData) continue;

      // 1. Idempotency Check: if job is already processed, skip
      if (jobData.status === 'completed') {
        console.log(`[AI Worker] Idempotency Hit: Job ${jobId} is already completed. Skipping.`);
        continue;
      }

      console.log(`[AI Worker] Started processing job: ${jobId} (Attempt ${jobData.attempts + 1}/${this.maxAttempts})`);
      
      const currentAttempts = jobData.attempts + 1;
      await this.updateJob(jobId, { 
        status: 'processing',
        attempts: currentAttempts
      });

      try {
        // Run AI classification
        const result = await AIService.classifyFeedback(jobData.text);
        
        // Success: Update job status
        await this.updateJob(jobId, {
          status: 'completed',
          result: result,
          completedAt: new Date().toISOString()
        });
        console.log(`[AI Worker] Job completed successfully: ${jobId}`);

      } catch (err) {
        console.warn(`[AI Worker Warning] Job ${jobId} failed on attempt ${currentAttempts}:`, err.message);

        if (currentAttempts < this.maxAttempts) {
          // Retry: Put back in queue and mark pending
          await this.updateJob(jobId, { 
            status: 'pending',
            error: err.message
          });
          
          if (this.redisClient && this.redisClient.isOpen) {
            await this.redisClient.lPush('queue:ai_jobs', jobId);
          } else {
            this.inMemoryQueue.push(jobId);
          }
          
          console.log(`[AI Worker] Re-enqueued job ${jobId} for retry.`);
        } else {
          // Permanent Failure: Log Alert and mark failed
          console.error(`[ALERT] AI Classification Job ${jobId} FAILED permanently after ${currentAttempts} attempts. Error: ${err.message}`);
          
          await this.updateJob(jobId, {
            status: 'failed',
            error: err.message,
            alerted: true,
            completedAt: new Date().toISOString()
          });
        }
      }
    }
  }
}

module.exports = AIJobService;
