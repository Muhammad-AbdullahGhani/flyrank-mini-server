const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

class ScraperService {
  constructor() {
    this.baseUrl = 'https://quotes.toscrape.com';
    this.userAgent = 'FlyRankPoliteBot/1.0 (+https://github.com/Muhammad-AbdullahGhani/flyrank-mini-server; contact: intern@flyrank.com)';
    this.dataDir = path.join(__dirname, '../../data');
    this.filePath = path.join(this.dataDir, 'scraped_quotes.json');
    this.isScraping = false;

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Fetches and parses robots.txt
   */
  async getRobotsRules() {
    const defaultRules = { disallowedPaths: [], crawlDelay: 1000 };
    try {
      const robotsUrl = `${this.baseUrl}/robots.txt`;
      console.log(`[Scraper] Fetching robots.txt from: ${robotsUrl}`);
      
      const res = await fetch(robotsUrl, { headers: { 'User-Agent': this.userAgent } });
      if (!res.ok) {
        console.log(`[Scraper] No robots.txt found (status ${res.status}). Using default rules.`);
        return defaultRules;
      }

      const text = await res.text();
      const lines = text.split('\n');
      let isApplicable = false;
      let crawlDelay = 1000;
      const disallowedPaths = [];

      for (const line of lines) {
        const cleaned = line.trim();
        if (cleaned.toLowerCase().startsWith('user-agent:')) {
          const agent = cleaned.substring(11).trim();
          isApplicable = (agent === '*' || this.userAgent.toLowerCase().includes(agent.toLowerCase()));
        } else if (isApplicable) {
          if (cleaned.toLowerCase().startsWith('disallow:')) {
            const path = cleaned.substring(9).trim();
            if (path) disallowedPaths.push(path);
          } else if (cleaned.toLowerCase().startsWith('crawl-delay:')) {
            const delay = parseFloat(cleaned.substring(12).trim());
            if (!isNaN(delay)) {
              crawlDelay = delay * 1000; // to ms
            }
          }
        }
      }

      console.log(`[Scraper] robots.txt parsed. Delay: ${crawlDelay}ms. Disallowed:`, disallowedPaths);
      return { disallowedPaths, crawlDelay };
    } catch (err) {
      console.warn('[Scraper Warning] Failed to parse robots.txt, using defaults:', err.message);
      return defaultRules;
    }
  }

  /**
   * Checks if path is allowed under robots.txt rules
   */
  isPathAllowed(pathToCheck, disallowedPaths) {
    return !disallowedPaths.some(disallowed => {
      if (disallowed === '/') return true;
      return pathToCheck.startsWith(disallowed);
    });
  }

  /**
   * Main crawl / scrape function
   */
  async runScraper(maxPages = 3) {
    if (this.isScraping) {
      throw new Error('Scraper is already running.');
    }

    this.isScraping = true;
    console.log(`[Scraper] Starting polite scrape of ${this.baseUrl} (Max pages: ${maxPages})`);
    
    try {
      const { disallowedPaths, crawlDelay } = await this.getRobotsRules();
      const scrapedRecords = [];
      let currentPage = '/';
      let pageCount = 0;

      while (currentPage && pageCount < maxPages) {
        if (!this.isPathAllowed(currentPage, disallowedPaths)) {
          console.warn(`[Scraper Blocked] Path "${currentPage}" is disallowed by robots.txt.`);
          break;
        }

        pageCount++;
        const targetUrl = `${this.baseUrl}${currentPage}`;
        console.log(`[Scraper] Fetching [Page ${pageCount}/${maxPages}]: ${targetUrl}`);

        const response = await fetch(targetUrl, {
          headers: { 'User-Agent': this.userAgent }
        });

        if (!response.ok) {
          console.error(`[Scraper Error] Failed to fetch page (status ${response.status})`);
          break;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract quotes
        $('.quote').each((_, element) => {
          const text = $(element).find('.text').text().trim().replace(/^“|”$/g, '');
          const author = $(element).find('.author').text().trim();
          const tags = [];
          
          $(element).find('.tags .tag').each((__, tagEl) => {
            tags.push($(tagEl).text().trim());
          });

          scrapedRecords.push({
            text,
            author,
            tags,
            scrapedAt: new Date().toISOString()
          });
        });

        // Resolve next page link
        const nextLink = $('li.next a').attr('href');
        currentPage = nextLink || null;

        // Polite delay between requests
        if (currentPage && pageCount < maxPages) {
          console.log(`[Scraper] Respecting politeness delay. Waiting ${crawlDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, crawlDelay));
        }
      }

      // Save records to JSON
      fs.writeFileSync(this.filePath, JSON.stringify(scrapedRecords, null, 2), 'utf-8');
      console.log(`[Scraper] Completed. Saved ${scrapedRecords.length} quotes to ${this.filePath}`);
      
      this.isScraping = false;
      return {
        success: true,
        pagesScraped: pageCount,
        recordsCount: scrapedRecords.length,
        filePath: this.filePath
      };

    } catch (err) {
      this.isScraping = false;
      console.error('[Scraper Error] Run failed:', err);
      throw err;
    }
  }

  /**
   * Retrieve currently saved quotes
   */
  getSavedQuotes() {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
  }
}

module.exports = new ScraperService();
