// Public settings for the tree pages. None of these are secrets.
window.TREE_CONFIG = Object.assign({
  // Apps Script web app URL (Deploy > Manage deployments), ends in /exec
  API_URL: 'PASTE-YOUR-APPS-SCRIPT-WEB-APP-URL',
  // Google OAuth client ID (Google Cloud > Google Auth Platform > Clients)
  CLIENT_ID: 'PASTE-YOUR-OAUTH-CLIENT-ID.apps.googleusercontent.com',
  // The address written onto the tags. Must never change once tags are out.
  BASE_URL: 'https://trees.theurbanjungleproject.com',
  PHOTO_MAX_SIDE: 2400,
  PHOTO_QUALITY: 0.85,
  PUBLIC_TEXT: 'This tree is part of a greening project by The Urban Jungle Project. We track its health so it can grow old in the city.',
  LABELS: { tag_label: 'Tree ID', species: 'Species', project: 'Project', product_type: 'Planted in', install_date: 'Planted on' }
}, window.TREE_CONFIG || {});
