const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');

class ReportService {
  constructor(todoService, dbPool, redisClient) {
    this.todoService = todoService;
    this.dbPool = dbPool;
    this.redisClient = redisClient;
    
    this.inMemoryJobs = new Map();
    this.inMemoryQueue = [];
    this.isWorkerRunning = false;

    // Resolve reports directory in public folder
    this.reportsDir = path.join(__dirname, '../../public/reports');
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }

    // Schedule task for stretch goal (Runs every 10 minutes by default)
    const cronSchedule = process.env.REPORT_CRON || '*/10 * * * *';
    cron.schedule(cronSchedule, async () => {
      console.log(`[Scheduler] Triggering scheduled report generation (Cron: "${cronSchedule}")...`);
      try {
        const job = await this.createReportJob();
        console.log(`[Scheduler] Successfully enqueued scheduled job: ${job.id}`);
      } catch (err) {
        console.error('[Scheduler] Failed to trigger scheduled job:', err.message);
      }
    });
  }

  /**
   * Enqueues a new PDF report generation job
   */
  async createReportJob() {
    const jobId = crypto.randomUUID();
    const jobData = {
      id: jobId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
      downloadUrl: null,
      error: null
    };

    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.set(`job:${jobId}`, JSON.stringify(jobData));
      await this.redisClient.lPush('queue:reports', jobId);
    } else {
      this.inMemoryJobs.set(jobId, jobData);
      this.inMemoryQueue.push(jobId);
    }

    console.log(`[Queue] Enqueued job: ${jobId}`);
    
    // Trigger the worker loop asynchronously
    this.triggerWorker();

    return jobData;
  }

  /**
   * Fetches the current status of a job
   */
  async getJobStatus(jobId) {
    if (this.redisClient && this.redisClient.isOpen) {
      const data = await this.redisClient.get(`job:${jobId}`);
      return data ? JSON.parse(data) : null;
    } else {
      return this.inMemoryJobs.get(jobId) || null;
    }
  }

  /**
   * Updates job metadata in storage
   */
  async updateJob(jobId, updates) {
    if (this.redisClient && this.redisClient.isOpen) {
      const data = await this.redisClient.get(`job:${jobId}`);
      if (data) {
        const job = JSON.parse(data);
        const updatedJob = { ...job, ...updates };
        await this.redisClient.set(`job:${jobId}`, JSON.stringify(updatedJob));
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
      console.error('[Worker Fatal] Thread crashed:', err);
      this.isWorkerRunning = false;
    });
  }

  /**
   * The background worker loop that pulls from Redis or RAM queue
   */
  async _runWorker() {
    while (true) {
      let jobId = null;
      if (this.redisClient && this.redisClient.isOpen) {
        jobId = await this.redisClient.rPop('queue:reports');
      } else {
        jobId = this.inMemoryQueue.shift();
      }

      if (!jobId) {
        // Queue is empty, exit worker loop
        this.isWorkerRunning = false;
        break;
      }

      console.log(`[Worker] Started processing job: ${jobId}`);
      await this.updateJob(jobId, { status: 'processing' });

      try {
        // 1. Gather aggregated statistics from DB or RAM
        let stats = {};
        if (this.dbPool) {
          const aggResult = await this.dbPool.query(`
            SELECT 
              COUNT(*)::int as total, 
              COALESCE(SUM(CASE WHEN completed THEN 1 ELSE 0 END), 0)::int as completed,
              COALESCE(SUM(CASE WHEN NOT completed THEN 1 ELSE 0 END), 0)::int as pending
            FROM todos
          `);
          const todosResult = await this.dbPool.query('SELECT * FROM todos ORDER BY id ASC');
          const row = aggResult.rows[0];
          const total = row.total;
          stats = {
            total,
            completed: row.completed,
            pending: row.pending,
            completionRate: total > 0 ? Math.round((row.completed / total) * 100) : 0,
            todos: todosResult.rows
          };
        } else {
          const todos = await this.todoService.getAllTodos();
          const total = todos.length;
          const completed = todos.filter(t => t.completed).length;
          const pending = total - completed;
          stats = {
            total,
            completed,
            pending,
            completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
            todos
          };
        }

        // 2. Generate PDF Report with PDFKit
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument();
        const filePath = path.join(this.reportsDir, `${jobId}.pdf`);
        const writeStream = fs.createWriteStream(filePath);
        doc.pipe(writeStream);

        // Header Title
        doc.fillColor('#0f172a').fontSize(24).text('FlyRank Todo Performance Report', { align: 'center' });
        doc.moveDown(0.2);
        doc.fillColor('#475569').fontSize(10).text(`Job Identifier: ${jobId}`, { align: 'center' });
        doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        // Executive Summary Container Box
        doc.rect(50, 120, 500, 100).fillAndStroke('#f1f5f9', '#cbd5e1');
        doc.fillColor('#0f172a');
        doc.fontSize(14).text('Executive Summary', 70, 135, { underline: true });
        doc.fontSize(11).fillColor('#334155');
        doc.text(`Total Tasks: ${stats.total}`, 70, 160);
        doc.text(`Completed: ${stats.completed}`, 220, 160);
        doc.text(`Pending: ${stats.pending}`, 350, 160);
        doc.text(`Completion Rate: ${stats.completionRate}%`, 70, 185);
        doc.moveDown(4);

        // Detail list of tasks
        doc.fillColor('#0f172a').fontSize(14).text('Detailed Task Breakdown', 50, 240, { underline: true });
        doc.moveDown();
        
        let y = 270;
        stats.todos.forEach((todo) => {
          if (y > 700) {
            doc.addPage();
            y = 50;
          }
          const status = todo.completed ? 'COMPLETED' : 'PENDING';
          const bulletColor = todo.completed ? '#16a34a' : '#ea580c';
          doc.fillColor(bulletColor).fontSize(10).text(`• [${status}]`, 50, y);
          doc.fillColor('#334155').text(`ID: ${todo.id} - ${todo.title} (Created: ${new Date(todo.created_at || new Date()).toLocaleDateString()})`, 130, y);
          y += 20;
        });

        doc.end();

        // Wait for file stream to finish writing
        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });

        console.log(`[Worker] Job completed: ${jobId}`);
        await this.updateJob(jobId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          downloadUrl: `/reports/download/${jobId}`
        });

      } catch (err) {
        console.error(`[Worker] Job failed: ${jobId}`, err);
        await this.updateJob(jobId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: err.message
        });
      }
    }
  }
}

module.exports = ReportService;
