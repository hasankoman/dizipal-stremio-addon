const STYLESHEET = `
* {
   box-sizing: border-box;
   margin: 0;
   padding: 0;
}

html {
   min-height: 100vh;
   background-size: cover;
   background-position: center center;
   background-repeat: no-repeat;
   background-attachment: fixed;
   position: relative;
}

html::before {
   content: '';
   position: fixed;
   top: 0;
   left: 0;
   width: 100%;
   height: 100%;
   background: linear-gradient(135deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.65) 100%);
   backdrop-filter: blur(10px);
   -webkit-backdrop-filter: blur(10px);
   z-index: -1;
}

body {
   font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
   font-weight: 400;
   color: #ffffff;
   min-height: 100vh;
   line-height: 1.6;
   position: relative;
   padding: 2rem 0;
}

h1, h2, h3, h4, h5, h6 {
   font-weight: 600;
   line-height: 1.3;
   margin-bottom: 1rem;
}

#addon {
   max-width: 800px;
   width: 90%;
   min-height: 600px;
   position: relative;
   margin: 2rem auto;
   padding: 2rem;
   background: rgba(255, 255, 255, 0.05);
   border-radius: 20px;
   backdrop-filter: blur(10px);
   box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
   border: 1px solid rgba(255, 255, 255, 0.1);
   opacity: 0;
   animation: fadeIn 1s ease forwards;
   animation-delay: 0.1s;
}

a {
   color: #8A5AAB;
   text-decoration: none;
   transition: color 0.3s ease;
}

a:hover {
   color: #c4a6e9;
}

.install-link {
   text-decoration: none;
   display: block;
   width: 100%;
   max-width: 300px;
   margin: 0.5rem 0 2rem 0;
}

button#install {
   display: inline-flex;
   align-items: center;
   justify-content: center;
   gap: 10px;
   padding: 0.8rem 1.5rem;
   background: rgba(138, 90, 171, 0.1);
   border: 1px solid rgba(138, 90, 171, 0.2);
   border-radius: 8px;
   color: #8A5AAB;
   font-weight: 500;
   transition: all 0.3s ease;
   text-decoration: none;
   width: 100%;
   font-family: inherit;
   font-size: 1.1rem;
   cursor: pointer;
   text-align: center;
}

button#install svg {
   transform: translateY(2px);
}

.loading-spinner {
   width: 20px;
   height: 20px;
   display: none;
}

.loading-spinner svg {
   animation: rotate 1s linear infinite;
   width: 100%;
   height: 100%;
}

.loading-spinner circle {
   fill: none;
   stroke: #8A5AAB;
   stroke-width: 4;
   stroke-dasharray: 60, 180;
   stroke-linecap: round;
}

@keyframes rotate {
   100% {
      transform: rotate(360deg);
   }
}

button#install.loading .loading-spinner {
   display: inline-block;
}

button#install:hover {
   background: rgba(138, 90, 171, 0.2);
   transform: translateY(-2px);
   box-shadow: 0 4px 12px rgba(138, 90, 171, 0.2);
   color: #c4a6e9;
}

button#install:active {
   transform: translateY(0);
}

button#install:disabled {
   background: rgba(204, 204, 204, 0.1);
   border-color: rgba(204, 204, 204, 0.2);
   color: #999999;
   cursor: not-allowed;
   transform: none;
   box-shadow: none;
}

.header {
   display: flex;
   align-items: center;
   justify-content: space-between;
   margin-bottom: 2rem;
   gap: 2rem;
}

.logo {
   background-color: black;
   padding: 60px 20px;
   border-radius: 8px;
   width: 200px;
   height: 100px;
   display: flex;
   align-items: center;
   justify-content: center;
}

.logo img {
   width: 100%;
   height: auto;
   padding-top: 5px;
}

.header-text {
   flex-grow: 1;
   text-align: right;
}

.name {
   font-size: 2.5rem;
   margin-bottom: 0.5rem;
   text-align: right;
}

.version {
   font-size: 1.1rem;
   color: rgba(255, 255, 255, 0.7);
   text-align: right;
}

.description {
   font-size: 1.2rem;
   color: rgba(255, 255, 255, 0.9);
   text-align: center;
   margin-bottom: 2rem;
}

.separator {
   height: 1px;
   background: rgba(255, 255, 255, 0.1);
   margin: 2rem 0;
}

.provides,
.gives,
.description {
   margin-bottom: 1.5rem;
}

ul {
   list-style: none;
   padding: 0;
   margin: 1rem 0;
}

ul li {
   padding: 0.5rem 0;
   padding-left: 1.5rem;
   position: relative;
}

ul li:before {
   content: "•";
   color: #8A5AAB;
   position: absolute;
   left: 0;
}

.alert {
   color: #ff6b6b;
   background: rgba(255, 107, 107, 0.1);
   padding: 1rem;
   border-radius: 8px;
   margin: 1rem 0;
}

input[type="text"], input[type="password"] {
   width: 100%;
   max-width: 300px;
   padding: 0.8rem 1rem;
   border: 2px solid rgba(255, 255, 255, 0.1);
   border-radius: 8px;
   background: rgba(255, 255, 255, 0.05);
   color: white;
   font-size: 1rem;
   margin: 1rem 0;
   transition: all 0.3s ease;
}

input[type="text"]:focus {
   border-color: #8A5AAB;
   outline: none;
   box-shadow: 0 0 0 3px rgba(138, 90, 171, 0.2);
}

.contact {
   text-align: center;
   margin-top: 2rem;
   padding: 1rem;
   background: rgba(255, 255, 255, 0.05);
   border-radius: 8px;
}

.links {
   display: flex;
   gap: 1rem;
   justify-content: center;
   margin-top: 2rem;
   flex-wrap: wrap;
}

.links a {
   display: inline-flex;
   align-items: center;
   gap: 0.5rem;
   padding: 0.8rem 1.5rem;
   background: rgba(138, 90, 171, 0.1);
   border: 1px solid rgba(138, 90, 171, 0.2);
   border-radius: 8px;
   color: #8A5AAB;
   font-weight: 500;
   transition: all 0.3s ease;
   text-decoration: none;
}

.links a svg {
   width: 20px;
   height: 20px;
   fill: currentColor;
}

.links a:hover {
   background: rgba(138, 90, 171, 0.2);
   transform: translateY(-2px);
   box-shadow: 0 4px 12px rgba(138, 90, 171, 0.2);
   color: #c4a6e9;
}

.links a:active {
   transform: translateY(0);
}

@media (max-width: 768px) {
   #addon {
      margin: 1rem;
      padding: 1.5rem;
   }
   
   .header {
      flex-direction: column;
      text-align: center;
   }
   
   .logo {
      max-width: 120px;
   }
   
   .header-text {
      text-align: center;
   }
   
   .name {
      font-size: 2rem;
      text-align: center;
   }
   
   .version {
      text-align: center;
   }
   
   .install-link {
      max-width: 100%;
   }
   
   button#install {
      padding: 0.8rem 2rem;
   }
   
   .links {
      flex-direction: column;
      align-items: center;
   }
   
   .links a {
      width: 100%;
      max-width: 300px;
      justify-content: center;
   }
}

.verification-container {
   display: flex;
   align-items: flex-start;
   justify-content: space-between;
   gap: 2rem;
   min-height: 300px;
   padding-top: 2rem;
}

.verification-section {
   flex: 0 0 300px;
   margin-bottom: 1rem;
   display: flex;
   flex-direction: column;
   justify-content: flex-start;
}

.animation-section {
   flex: 1;
   display: flex;
   justify-content: center;
   align-items: center;
   padding: 3rem 0;
   margin-top: 2rem;
}

.stremio-loader {
   width: 150px;
   height: 150px;
   transition: all 0.3s ease;
}

.stremio-loader circle {
   fill: none;
   stroke: #8A5AAB;
   stroke-width: 2;
   stroke-linecap: round;
   transform-origin: center;
   stroke-dasharray: 283;
   stroke-dashoffset: 0;
   opacity: 0.1;
   transform: rotate(-90deg);
   transition: all 0.3s ease;
}

.stremio-loader.active circle {
   opacity: 1;
   stroke-dashoffset: 283;
   transition: none;
}

.stremio-loader.active.success circle {
   stroke-dashoffset: 0;
   transition: stroke-dashoffset 0.3s ease;
}

.stremio-loader .checkmark {
   stroke-dasharray: 100;
   stroke-dashoffset: 0;
   stroke: #4CAF50;
   stroke-width: 3;
   stroke-linecap: round;
   stroke-linejoin: round;
   fill: none;
   opacity: 0.1;
   transform-origin: center;
   transition: all 0.3s ease;
}

.stremio-loader.active .checkmark {
   opacity: 0;
}

.stremio-loader.success .checkmark {
   opacity: 1;
   transition: opacity 0.3s ease 0.3s;
}

.stremio-loader.reverse circle {
   opacity: 0;
   transition: opacity 0.5s ease;
}

.stremio-loader.reverse .checkmark {
   stroke-dashoffset: 100;
   opacity: 0;
   transition: all 0.5s ease;
}

@media (max-width: 768px) {
   .verification-container {
      flex-direction: column;
      min-height: auto;
      padding: 1rem 0;
   }

   .verification-section {
      flex: none;
      width: 100%;
   }

   .animation-section {
      min-height: 200px;
      padding: 2rem 0;
      margin-top: 1rem;
   }

   .stremio-loader {
      width: 150px;
      height: 150px;
   }
}

@keyframes fadeInUp {
   from {
      opacity: 0;
      transform: translateY(20px);
   }
   to {
      opacity: 1;
      transform: translateY(0);
   }
}

.animate-in {
   opacity: 0;
   animation: fadeInUp 0.6s ease forwards;
}

.header {
   animation-delay: 0.2s;
}

.description {
   animation-delay: 0.4s;
}

.features-container {
   opacity: 0;
   animation: fadeInUp 0.6s ease forwards;
   animation-delay: 0.6s;
   margin: 2rem 0;
}

.verification-container {
   animation-delay: 0.8s;
}

.donation-section {
   animation-delay: 1s;
}

.contact-info {
   animation-delay: 1.2s;
}

.links {
   animation-delay: 1.4s;
}

@keyframes fadeIn {
   from {
      opacity: 0;
   }
   to {
      opacity: 1;
   }
}

// Sayfa yüklendiğinde animasyonları başlat
document.addEventListener('DOMContentLoaded', () => {
   const addon = document.getElementById('addon');
   const elements = document.querySelectorAll('.animate-in');
   
   // Addon fade animasyonunu resetle
   addon.style.opacity = '0';
   addon.style.animation = 'none';
   setTimeout(() => {
      addon.style.animation = '';
   }, 50);

   // Diğer elementlerin animasyonlarını resetle
   elements.forEach(element => {
      element.style.opacity = '0';
      element.style.animation = 'none';
      setTimeout(() => {
         element.style.animation = '';
      }, 100);
   });
});
`

function landingTemplate(manifest) {
	const background = manifest.background || 'https://dl.strem.io/addon-background.jpg'
	const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png'
   const favicon = '/images/favicon.png'
	const contactHTML = manifest.contactEmail ?
		`<div class="contact">
         <p>Contact ${manifest.name} creator:</p>
         <a href="mailto:${manifest.contactEmail}">${manifest.contactEmail}</a>
      </div>` : ''

	const stylizedTypes = manifest.types
		.map(t => t[0].toUpperCase() + t.slice(1) + (t !== 'series' ? 's' : ''))

	return `
   <!DOCTYPE html>
   <html style="background-image: url(${background});">
   <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${manifest.name} - Stremio Addon</title>
      <style>${STYLESHEET}</style>
      <link rel="shortcut icon" href="${favicon}" type="image/x-icon">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
   </head>
	<body>
      <div id="addon">
         <div class="header animate-in">
            <div class="logo">
               <img src="${logo}" alt="${manifest.name} Logo">
            </div>
            <div class="header-text">
               <h1 class="name">${manifest.name}</h1>
               <h2 class="version">v${manifest.version || '0.0.0'}</h2>
            </div>
         </div>
         
         <p class="description animate-in">${manifest.description || ''}</p>
         
         <div class="separator"></div>

         <div class="features-container animate-in">
            <h3>Bu eklenti şunları destekler:</h3>
            <ul>
               <li>Filmler</li>
               <li>Diziler</li>
            </ul>

            <div class="alert">
               <h3>Önemli Not</h3>
               <p>Videoları oynatmada sorun yaşıyorsanız, kurulumdan sonra dizi veya film arayın ve biraz aşağı kaydırın.</p>
               <p>Eğer stremioyu web sürümünde kullanıyorsanız arkada stremio hizmeti ya da uygulaması çalışması gerek.</p>
            </div>
         </div>

         <div class="separator"></div>

         <div class="verification-container animate-in">
            <div class="verification-section">
               <h6>Bot olmadığınızı onaylayın.</h6>
               <h4>Türkiye'nin başkenti neresidir?</h4>
               <input type="text" id='soru' placeholder="Yanıt" required>
               <a id="installLink" class="install-link" href="#">
                  <button id='install' name="Install" disabled>
                     <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                     </svg>
                     <span>Eklentiyi Yükle</span>
                     <div class="loading-spinner">
                        <svg viewBox="0 0 50 50">
                           <circle cx="25" cy="25" r="20"></circle>
                        </svg>
                     </div>
                  </button>
               </a>
            </div>
            <div class="animation-section">
               <svg class="stremio-loader" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="35"/>
                  <path class="checkmark" d="M30,50 L45,65 L70,35" stroke-linecap="round" stroke-linejoin="round"/>
               </svg>
            </div>
         </div>

      </div>

      <script>
         const soru = document.getElementById("soru");
         const install = document.getElementById("install");
         const installLink = document.getElementById("installLink");
         const loader = document.querySelector('.stremio-loader');

         function startInstallAnimation() {
            install.classList.add('loading');
            loader.classList.add('active');
            
            setTimeout(() => {
               loader.classList.add('success');
               install.classList.remove('loading');

               setTimeout(() => {
                  loader.classList.remove('active', 'success');
               }, 2000);
            }, 50);
         }

         function checkAnswer(value) {
            const answer = String(value).trim().toLowerCase();
            if(answer === 'ankara') {
               installLink.href = 'stremio://' + window.location.host + '/addon/manifest.json';
               install.disabled = false;
               return true;
            } else {
               installLink.href = '#';
               install.disabled = true;
               return false;
            }
         }

         soru.addEventListener("keyup", (event) => {
            const isValid = checkAnswer(soru.value);
            if (event.key === 'Enter' && isValid) {
               event.preventDefault();
               startInstallAnimation();
               window.location.href = installLink.href;
            }
         });

         install.addEventListener('click', () => {
            startInstallAnimation();
         });

         // Sayfa yüklendiğinde animasyonları başlat
         document.addEventListener('DOMContentLoaded', () => {
            const addon = document.getElementById('addon');
            const elements = document.querySelectorAll('.animate-in');
            
            // Addon fade animasyonunu resetle
            addon.style.opacity = '0';
            addon.style.animation = 'none';
            setTimeout(() => {
               addon.style.animation = '';
            }, 50);

            // Diğer elementlerin animasyonlarını resetle
            elements.forEach(element => {
               element.style.opacity = '0';
               element.style.animation = 'none';
               setTimeout(() => {
                  element.style.animation = '';
               }, 100);
            });
         });
      </script>
	</body>
	</html>`
}
module.exports = landingTemplate