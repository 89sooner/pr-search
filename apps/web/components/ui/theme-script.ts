/** Fixed application code only; no user input is interpolated into this script. */
export const themeBootstrapScript = `(function(){var t;try{t=localStorage.getItem('pr-search-theme')}catch(e){}if(t!=='light'&&t!=='dark')t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t})()`;
