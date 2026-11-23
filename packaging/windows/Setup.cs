using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Abyssinia AI Setup")]
[assembly: AssemblyProduct("Abyssinia AI")]

internal static class Setup {
    [STAThread]
    static int Main(string[] args) {
        bool extract = args.Length == 2 && args[0] == "--extract";
        try {
            if (args.Length != 0 && !extract) return 2;
            string root = extract ? Path.GetFullPath(args[1]) :
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AbyssiniaAI", "releases");
            if (!extract && MessageBox.Show("Install Abyssinia AI for your Windows account? The app and engine setup shortcuts will open in File Explorer.", "Abyssinia AI", MessageBoxButtons.OKCancel) != DialogResult.OK) return 0;
            Directory.CreateDirectory(root);
            string stage = Directory.CreateDirectory(Path.Combine(root, "setup-" + Guid.NewGuid().ToString("N"))).FullName;
            try {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("distribution.zip"))
                using (ZipArchive zip = new ZipArchive(stream, ZipArchiveMode.Read)) {
                    zip.ExtractToDirectory(stage);
                }
                if (!File.Exists(Path.Combine(stage, "Open Abyssinia AI.cmd")) ||
                    !File.Exists(Path.Combine(stage, "Setup Abyssinia Engine.cmd"))) throw new InvalidDataException("Incomplete package.");
                string destination = Path.Combine(root, "Abyssinia AI " + Guid.NewGuid().ToString("N").Substring(0,8));
                Directory.Move(stage, destination);
                if (!extract) Process.Start("explorer.exe", "\"" + destination + "\"");
            } finally {
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
            }
            return 0;
        } catch (Exception error) {
            if (!extract) MessageBox.Show(error.Message, "Installation failed");
            return 1;
        }
    }
}
