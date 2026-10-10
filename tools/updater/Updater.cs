// "Update Site.exe" — scrapes from this PC, uploads deals.json to the 'site-data' release,
// and runs the deploy workflow in publish-only mode. Build: tools\build-updater.bat
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class Updater : Form
{
    const string Repo = "shreywy/deal-scraper";
    const string SiteUrl = "https://shreywy.github.io/deal-scraper/";

    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly Label status = new Label();
    readonly Label detail = new Label();
    readonly ProgressBar bar = new ProgressBar();
    readonly TextBox log = new TextBox();
    readonly Button details = new Button();
    readonly Button close = new Button();
    readonly StringBuilder logText = new StringBuilder();
    Process current; // killed (with its children) if the window is closed mid-run

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.Run(new Updater());
    }

    Updater()
    {
        Text = "Update dealsco";
        Font = new Font("Segoe UI", 9.5f);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 132);
        BackColor = Color.White;

        status.SetBounds(20, 18, 420, 22);
        status.Font = new Font("Segoe UI Semibold", 11f);
        detail.SetBounds(20, 42, 420, 20);
        detail.ForeColor = Color.DimGray;
        detail.AutoEllipsis = true;
        bar.SetBounds(20, 68, 420, 10);
        bar.Maximum = 1000;
        details.SetBounds(20, 92, 90, 28);
        details.Text = "Details";
        details.Click += delegate { ToggleLog(); };
        close.SetBounds(350, 92, 90, 28);
        close.Text = "Cancel";
        close.Click += delegate { Close(); };
        log.SetBounds(20, 132, 420, 220);
        log.Multiline = true;
        log.ReadOnly = true;
        log.ScrollBars = ScrollBars.Vertical;
        log.Font = new Font("Consolas", 8.5f);
        log.Visible = false;
        Controls.AddRange(new Control[] { status, detail, bar, details, close, log });

        Shown += delegate { Task.Run(() => Run()); };
        FormClosing += delegate
        {
            var p = current;
            if (p != null && !p.HasExited)
                Process.Start(new ProcessStartInfo("taskkill", "/T /F /PID " + p.Id) { CreateNoWindow = true, UseShellExecute = false });
        };
    }

    void ToggleLog()
    {
        log.Visible = !log.Visible;
        ClientSize = new Size(460, log.Visible ? 366 : 132);
        if (log.Visible)
        {
            lock (logText) log.Text = logText.ToString();
            log.SelectionStart = log.TextLength;
            log.ScrollToCaret();
        }
    }

    void Ui(Action a)
    {
        try { if (!IsDisposed) BeginInvoke(a); } catch (InvalidOperationException) { }
    }

    void Step(string s, string d, double frac)
    {
        Ui(() => { status.Text = s; detail.Text = d; bar.Value = (int)(Math.Min(1, frac) * 1000); });
    }

    void Log(string line)
    {
        lock (logText) logText.AppendLine(line);
        Ui(() => { if (log.Visible) log.AppendText(line + Environment.NewLine); });
    }

    // Runs a command in the repo folder, streaming each output line to onLine. Returns the exit code.
    int Exec(string file, string args, Action<string> onLine)
    {
        Log("> " + file + " " + args);
        var psi = new ProcessStartInfo(file, args)
        {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        using (var p = Process.Start(psi))
        {
            current = p;
            DataReceivedEventHandler h = (s, e) =>
            {
                if (e.Data == null) return;
                Log(e.Data);
                if (onLine != null) onLine(e.Data);
            };
            p.OutputDataReceived += h;
            p.ErrorDataReceived += h;
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();
            current = null;
            return p.ExitCode;
        }
    }

    string RunOutput(string file, string args)
    {
        var sb = new StringBuilder();
        if (Exec(file, args, l => sb.AppendLine(l)) != 0) throw new Exception(file + " " + args.Split(' ')[0] + " failed - see Details");
        return sb.ToString().Trim();
    }

    void Run()
    {
        try
        {
            if (!File.Exists(Path.Combine(root, "scrape.js")))
                throw new Exception("Put this exe in the deal-scraper folder (next to scrape.js).");

            // 1. Scrape from this PC (0-75%)
            int total = 0, done = 0;
            Step("Scraping stores…", "Starting browser", 0.02);
            int code = Exec("cmd.exe", "/c npm run scrape", line =>
            {
                var start = Regex.Match(line, @"^Starting scrape for: (.+)$");
                if (start.Success) { total = start.Groups[1].Value.Split(',').Length; return; }
                var fin = Regex.Match(line, @"^(\w+): (\d+ deals found|failed — .*)$");
                if (fin.Success && total > 0)
                {
                    done++;
                    Step("Scraping stores…", done + " of " + total + " stores · " + fin.Groups[1].Value + ": " + fin.Groups[2].Value, 0.02 + 0.73 * done / total);
                }
            });
            if (code != 0) throw new Exception("Scrape failed or found too few deals - see Details.");

            // 2. Upload deals.json to the 'site-data' release (75-82%)
            Step("Uploading deals…", "data/deals.json → GitHub release 'site-data'", 0.76);
            if (Exec("gh", "release view site-data --repo " + Repo, null) != 0)
                RunOutput("gh", "release create site-data --repo " + Repo + " --title \"Site data\" --notes \"deals.json from the desktop updater (used by the deploy workflow)\" --latest=false");
            RunOutput("gh", "release upload site-data data/deals.json --clobber --repo " + Repo);

            // 3. Publish through the workflow (82-100%)
            Step("Publishing…", "Starting GitHub workflow", 0.82);
            string listArgs = "run list --repo " + Repo + " --workflow deploy.yml --limit 1 --json databaseId -q .[0].databaseId";
            string before = RunOutput("gh", listArgs);
            RunOutput("gh", "workflow run deploy.yml --repo " + Repo + " -f source=local");
            string runId = null;
            for (int i = 0; i < 30 && runId == null; i++)
            {
                Thread.Sleep(2000);
                string id = RunOutput("gh", listArgs);
                if (id != "" && id != before) runId = id;
            }
            if (runId == null) throw new Exception("The workflow run didn't start.");

            var json = new JavaScriptSerializer();
            double frac = 0.84;
            while (true)
            {
                Thread.Sleep(4000);
                var run = json.Deserialize<Dictionary<string, object>>(RunOutput("gh", "run view " + runId + " --repo " + Repo + " --json status,conclusion,jobs"));
                string step = CurrentStep(run);
                frac = Math.Min(0.98, frac + 0.01);
                Step("Publishing…", step ?? "Waiting for GitHub", frac);
                if ((string)run["status"] == "completed")
                {
                    if ((string)run["conclusion"] != "success")
                        throw new Exception("Deploy " + run["conclusion"] + ": https://github.com/" + Repo + "/actions/runs/" + runId);
                    break;
                }
            }

            Step("Site updated ✓", SiteUrl, 1);
            Ui(() => { close.Text = "Close"; });
            Thread.Sleep(4000);
            Ui(() => Close());
        }
        catch (Exception ex)
        {
            Log("ERROR: " + ex.Message);
            Ui(() =>
            {
                status.Text = "Update failed";
                status.ForeColor = Color.Firebrick;
                detail.Text = ex.Message;
                close.Text = "Close";
                if (!log.Visible) ToggleLog();
            });
        }
    }

    static string CurrentStep(Dictionary<string, object> run)
    {
        var jobs = run["jobs"] as IEnumerable;
        if (jobs == null) return null;
        foreach (Dictionary<string, object> job in jobs)
        {
            var steps = job["steps"] as IEnumerable;
            if (steps == null) continue;
            foreach (Dictionary<string, object> s in steps)
                if ((string)s["status"] == "in_progress") return job["name"] + ": " + s["name"];
        }
        return null;
    }
}
