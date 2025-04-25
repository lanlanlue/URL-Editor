export function initDarkMode() {
  const root = document.documentElement;
  const button = document.getElementById("toggle-dark");

  // 初始狀態
  const isDark = localStorage.getItem("theme") === "dark";
  if (isDark) {
    root.classList.add("dark");
  }

  button.addEventListener("click", () => {
    root.classList.toggle("dark");
    const nowDark = root.classList.contains("dark");
    localStorage.setItem("theme", nowDark ? "dark" : "light");
  });
}
