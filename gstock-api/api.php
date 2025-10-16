<?php
// Gstock API (SQLite + PHP) – version 1.0
// Déposer ce fichier en /Web/gstock-api/api.php (QNAP Apache/PHP)
// Requis: extension PDO + pdo_sqlite

header('Content-Type: application/json; charset=utf-8');

// --- CONFIG ---
$API_SECRET = 'change-me-very-strong'; // <<< Mets une clé forte
$DB_DIR = __DIR__ . '/data';
$DB_FILE = $DB_DIR . '/gstock.sqlite';

// --- AUTH ---
$apiKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
if ($apiKey !== $API_SECRET) {
  http_response_code(401);
  echo json_encode(['ok'=>false, 'error'=>'unauthorized']);
  exit;
}

// --- CORS (si tu sers le front d’un autre host, sinon commente) ---
// header('Access-Control-Allow-Origin: https://ton-front.local');
// header('Vary: Origin');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  header('Access-Control-Allow-Headers: X-API-Key, Content-Type');
  header('Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS');
  exit;
}

// --- INIT DB ---
if (!file_exists($DB_DIR)) { @mkdir($DB_DIR, 0775, true); }
try {
  $pdo = new PDO('sqlite:' . $DB_FILE);
  $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');

  // tables
  $pdo->exec('CREATE TABLE IF NOT EXISTS items (
    code TEXT PRIMARY KEY,
    name TEXT,
    ref TEXT,
    qty INTEGER DEFAULT 0,
    threshold INTEGER DEFAULT 0,
    tags TEXT,        -- JSON
    location TEXT,
    links TEXT,       -- JSON
    type TEXT,        -- stock | atelier
    updated INTEGER
  )');
  $pdo->exec('CREATE TABLE IF NOT EXISTS moves (
    id TEXT PRIMARY KEY,
    ts INTEGER,
    type TEXT,       -- ENTRY | EXIT
    code TEXT,
    name TEXT,
    qty INTEGER,
    note TEXT
  )');
  $pdo->exec('CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    ts INTEGER,
    code TEXT,
    name TEXT,
    person TEXT,
    due TEXT,
    note TEXT,
    returnedAt INTEGER
  )');
  $pdo->exec('CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    buffer INTEGER,
    debug INTEGER,
    defaultTagsStock TEXT,        -- JSON
    defaultTagsAtelier TEXT,      -- JSON
    defaultLocationsStock TEXT,   -- JSON
    defaultLocationsAtelier TEXT  -- JSON
  )');
  // settings par défaut
  $s = $pdo->query("SELECT 1 FROM settings WHERE id='settings'")->fetch();
  if (!$s) {
    $stmt = $pdo->prepare('INSERT INTO settings (id,buffer,debug,defaultTagsStock,defaultTagsAtelier,defaultLocationsStock,defaultLocationsAtelier)
      VALUES ("settings",0,0,"[]","[]","[]","[]")');
    $stmt->execute();
  }
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(['ok'=>false,'error'=>'db-fail','detail'=>$e->getMessage()]);
  exit;
}

// --- Helpers ---
function jbody() {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $j = json_decode($raw, true);
  return is_array($j)? $j : [];
}
function ok($data=null){ echo json_encode(['ok'=>true,'data'=>$data], JSON_UNESCAPED_UNICODE); exit; }
function fail($code=400,$msg='bad-request'){ http_response_code($code); echo json_encode(['ok'=>false,'error'=>$msg]); exit; }
function uid($p='ID'){ return $p.'-'.dechex(time()).'-'.substr(md5(uniqid('',true)),0,8); }

// --- Router (via query r=/path...) OU via /api.php/path ---
$path = $_GET['r'] ?? '';
if (!$path) {
  // Support /api.php/foo/bar
  $uri = $_SERVER['REQUEST_URI'];
  $pos = strpos($uri, 'api.php');
  $path = $pos!==false ? substr($uri, $pos+7) : '/';
}
$path = strtok($path,'?');
$method = $_SERVER['REQUEST_METHOD'];

// normalise
function jenc($v){ return json_encode($v, JSON_UNESCAPED_UNICODE); }
function jdec($s){ if($s===null||$s==='') return null; $v=json_decode($s,true); return is_array($v)?$v:[]; }

// --- Routes ---
// GET /health
if ($method==='GET' && $path==='/health') ok(['status'=>'up']);

// SETTINGS
if ($path==='/settings') {
  if ($method==='GET') {
    $row=$pdo->query("SELECT * FROM settings WHERE id='settings'")->fetch(PDO::FETCH_ASSOC);
    if(!$row) $row=[];
    $row['defaultTagsStock']=jdec($row['defaultTagsStock']??'[]');
    $row['defaultTagsAtelier']=jdec($row['defaultTagsAtelier']??'[]');
    $row['defaultLocationsStock']=jdec($row['defaultLocationsStock']??'[]');
    $row['defaultLocationsAtelier']=jdec($row['defaultLocationsAtelier']??'[]');
    ok($row);
  }
  if ($method==='PUT') {
    $b=jbody();
    $stmt=$pdo->prepare('UPDATE settings SET buffer=:buffer, debug=:debug,
      defaultTagsStock=:t1, defaultTagsAtelier=:t2,
      defaultLocationsStock=:l1, defaultLocationsAtelier=:l2
      WHERE id="settings"');
    $stmt->execute([
      ':buffer'=>intval($b['buffer']??0),
      ':debug'=>!empty($b['debug'])?1:0,
      ':t1'=>jenc($b['defaultTagsStock']??[]),
      ':t2'=>jenc($b['defaultTagsAtelier']??[]),
      ':l1'=>jenc($b['defaultLocationsStock']??[]),
      ':l2'=>jenc($b['defaultLocationsAtelier']??[])
    ]);
    ok(true);
  }
  fail(405,'method-not-allowed');
}

// ITEMS
if ($path==='/items') {
  if ($method==='GET') {
    $type = $_GET['type'] ?? '';
    if ($type==='stock' || $type==='atelier') {
      $stmt=$pdo->prepare('SELECT * FROM items WHERE type=:t ORDER BY name COLLATE NOCASE');
      $stmt->execute([':t'=>$type]);
    } else {
      $stmt=$pdo->query('SELECT * FROM items ORDER BY name COLLATE NOCASE');
    }
    $rows=$stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach($rows as &$r){ $r['tags']=jdec($r['tags']??'[]'); $r['links']=jdec($r['links']??'[]'); }
    ok($rows);
  }
  if ($method==='POST') {
    $b=jbody();
    if(empty($b['code'])||empty($b['name'])) fail(400,'missing-fields');
    $stmt=$pdo->prepare('INSERT OR REPLACE INTO items(code,name,ref,qty,threshold,tags,location,links,type,updated)
      VALUES (:code,:name,:ref,:qty,:thr,:tags,:loc,:links,:type,:upd)');
    $stmt->execute([
      ':code'=>$b['code'],
      ':name'=>$b['name'],
      ':ref'=>$b['ref']??null,
      ':qty'=>intval($b['qty']??0),
      ':thr'=>intval($b['threshold']??0),
      ':tags'=>jenc($b['tags']??[]),
      ':loc'=>$b['location']??null,
      ':links'=>jenc($b['links']??[]),
      ':type'=>$b['type']??'stock',
      ':upd'=>intval($b['updated']??(time()*1000))
    ]);
    ok(true);
  }
  fail(405,'method-not-allowed');
}
if (preg_match('#^/items/([A-Za-z0-9_-]+)$#',$path,$m)){
  $code=$m[1];
  if ($method==='GET'){
    $stmt=$pdo->prepare('SELECT * FROM items WHERE code=:c'); $stmt->execute([':c'=>$code]);
    $r=$stmt->fetch(PDO::FETCH_ASSOC);
    if(!$r) fail(404,'not-found');
    $r['tags']=jdec($r['tags']??'[]'); $r['links']=jdec($r['links']??'[]');
    ok($r);
  }
  if ($method==='PUT'){
    $b=jbody();
    $stmt=$pdo->prepare('UPDATE items SET name=:name, ref=:ref, qty=:qty, threshold=:thr,
      tags=:tags, location=:loc, links=:links, type=:type, updated=:upd WHERE code=:code');
    $stmt->execute([
      ':code'=>$code,
      ':name'=>$b['name']??null,
      ':ref'=>$b['ref']??null,
      ':qty'=>intval($b['qty']??0),
      ':thr'=>intval($b['threshold']??0),
      ':tags'=>jenc($b['tags']??[]),
      ':loc'=>$b['location']??null,
      ':links'=>jenc($b['links']??[]),
      ':type'=>$b['type']??'stock',
      ':upd'=>intval($b['updated']??(time()*1000))
    ]);
    ok(true);
  }
  if ($method==='DELETE'){
    $stmt=$pdo->prepare('DELETE FROM items WHERE code=:c'); $stmt->execute([':c'=>$code]);
    ok(true);
  }
  fail(405,'method-not-allowed');
}
if (preg_match('#^/items/([A-Za-z0-9_-]+)/adjust$#',$path,$m)){
  $code=$m[1];
  if ($method==='POST'){
    $b=jbody(); $delta=intval($b['delta']??0);
    $pdo->beginTransaction();
    $stmt=$pdo->prepare('SELECT qty,name FROM items WHERE code=:c'); $stmt->execute([':c'=>$code]);
    $r=$stmt->fetch(PDO::FETCH_ASSOC);
    if(!$r){ $pdo->rollBack(); fail(404,'not-found'); }
    $new=max(0, intval($r['qty']) + $delta);
    $stmt=$pdo->prepare('UPDATE items SET qty=:q, updated=:u WHERE code=:c');
    $stmt->execute([':q'=>$new, ':u'=>time()*1000, ':c'=>$code]);
    $pdo->commit();
    ok(['qty'=>$new,'name'=>$r['name']]);
  }
  fail(405,'method-not-allowed');
}

// MOVES
if ($path==='/moves'){
  if ($method==='GET'){
    $from = isset($_GET['from']) ? intval($_GET['from']) : 0;
    $to   = isset($_GET['to'])   ? intval($_GET['to'])   : PHP_INT_MAX;
    $limit= isset($_GET['limit'])? intval($_GET['limit']): 1000;
    $stmt=$pdo->prepare('SELECT * FROM moves WHERE ts BETWEEN :f AND :t ORDER BY ts DESC LIMIT :lim');
    $stmt->bindValue(':f',$from,PDO::PARAM_INT);
    $stmt->bindValue(':t',$to,PDO::PARAM_INT);
    $stmt->bindValue(':lim',$limit,PDO::PARAM_INT);
    $stmt->execute();
    ok($stmt->fetchAll(PDO::FETCH_ASSOC));
  }
  if ($method==='POST'){
    $b=jbody();
    $rec=[
      'id'=> $b['id'] ?? uid('MV'),
      'ts'=> intval($b['ts']??(time()*1000)),
      'type'=> $b['type']??'ENTRY',
      'code'=> $b['code']??'',
      'name'=> $b['name']??'',
      'qty'=> intval($b['qty']??0),
      'note'=> $b['note']??''
    ];
    $stmt=$pdo->prepare('INSERT OR REPLACE INTO moves (id,ts,type,code,name,qty,note)
      VALUES (:id,:ts,:type,:code,:name,:qty,:note)');
    $stmt->execute($rec);
    ok(true);
  }
  fail(405,'method-not-allowed');
}

// LOANS
if ($path==='/loans'){
  if ($method==='GET'){
    $inc = !empty($_GET['includeClosed']);
    if ($inc){
      $stmt=$pdo->query('SELECT * FROM loans ORDER BY ts DESC');
    } else {
      $stmt=$pdo->query('SELECT * FROM loans WHERE returnedAt IS NULL ORDER BY ts DESC');
    }
    ok($stmt->fetchAll(PDO::FETCH_ASSOC));
  }
  if ($method==='POST'){
    $b=jbody();
    $rec=[
      'id'=> uid('LN'),
      'ts'=> intval($b['ts']??(time()*1000)),
      'code'=> $b['code']??'',
      'name'=> $b['name']??'',
      'person'=> $b['person']??'',
      'due'=> $b['due']??null,
      'note'=> $b['note']??''
    ];
    $stmt=$pdo->prepare('INSERT INTO loans (id,ts,code,name,person,due,note,returnedAt)
      VALUES (:id,:ts,:code,:name,:person,:due,:note,NULL)');
    $stmt->execute($rec);
    ok(true);
  }
  fail(405,'method-not-allowed');
}
if (preg_match('#^/loans/([A-Za-z0-9_-]+)/close$#',$path,$m)){
  $code=$m[1];
  if ($method==='POST'){
    // marque le plus récent non rendu
    $stmt=$pdo->prepare('SELECT * FROM loans WHERE code=:c AND returnedAt IS NULL ORDER BY ts DESC LIMIT 1');
    $stmt->execute([':c'=>$code]);
    $l=$stmt->fetch(PDO::FETCH_ASSOC);
    if(!$l) fail(404,'not-found');
    $stmt=$pdo->prepare('UPDATE loans SET returnedAt=:r WHERE id=:id');
    $stmt->execute([':r'=>time()*1000, ':id'=>$l['id']]);
    ok(true);
  }
  fail(405,'method-not-allowed');
}

// IMPORT / EXPORT
if ($path==='/export' && $method==='GET'){
  $items = $pdo->query('SELECT * FROM items')->fetchAll(PDO::FETCH_ASSOC);
  foreach($items as &$r){ $r['tags']=jdec($r['tags']??'[]'); $r['links']=jdec($r['links']??'[]'); }
  $moves = $pdo->query('SELECT * FROM moves')->fetchAll(PDO::FETCH_ASSOC);
  $loans = $pdo->query('SELECT * FROM loans')->fetchAll(PDO::FETCH_ASSOC);
  $s = $pdo->query("SELECT * FROM settings WHERE id='settings'")->fetch(PDO::FETCH_ASSOC);
  $s['defaultTagsStock']=jdec($s['defaultTagsStock']??'[]');
  $s['defaultTagsAtelier']=jdec($s['defaultTagsAtelier']??'[]');
  $s['defaultLocationsStock']=jdec($s['defaultLocationsStock']??'[]');
  $s['defaultLocationsAtelier']=jdec($s['defaultLocationsAtelier']??'[]');
  ok(['items'=>$items,'moves'=>$moves,'loans'=>$loans,'settings'=>$s]);
}
if ($path==='/import' && $method==='POST'){
  $b=jbody();
  $pdo->beginTransaction();
  try{
    $pdo->exec('DELETE FROM items');
    $pdo->exec('DELETE FROM moves');
    $pdo->exec('DELETE FROM loans');
    $stmt=$pdo->prepare('INSERT INTO items (code,name,ref,qty,threshold,tags,location,links,type,updated)
      VALUES (:code,:name,:ref,:qty,:thr,:tags,:loc,:links,:type,:upd)');
    foreach(($b['items']??[]) as $it){
      $stmt->execute([
        ':code'=>$it['code'],
        ':name'=>$it['name']??'',
        ':ref'=>$it['ref']??null,
        ':qty'=>intval($it['qty']??0),
        ':thr'=>intval($it['threshold']??0),
        ':tags'=>jenc($it['tags']??[]),
        ':loc'=>$it['location']??null,
        ':links'=>jenc($it['links']??[]),
        ':type'=>$it['type']??'stock',
        ':upd'=>intval($it['updated']??(time()*1000))
      ]);
    }
    $stmt=$pdo->prepare('INSERT INTO moves (id,ts,type,code,name,qty,note) VALUES (:id,:ts,:type,:code,:name,:qty,:note)');
    foreach(($b['moves']??[]) as $mv){
      $stmt->execute([
        ':id'=>$mv['id']??uid('MV'),
        ':ts'=>intval($mv['ts']??(time()*1000)),
        ':type'=>$mv['type']??'ENTRY',
        ':code'=>$mv['code']??'',
        ':name'=>$mv['name']??'',
        ':qty'=>intval($mv['qty']??0),
        ':note'=>$mv['note']??''
      ]);
    }
    $stmt=$pdo->prepare('INSERT INTO loans (id,ts,code,name,person,due,note,returnedAt) VALUES (:id,:ts,:code,:name,:person,:due,:note,:ret)');
    foreach(($b['loans']??[]) as $ln){
      $stmt->execute([
        ':id'=>$ln['id']??uid('LN'),
        ':ts'=>intval($ln['ts']??(time()*1000)),
        ':code'=>$ln['code']??'',
        ':name'=>$ln['name']??'',
        ':person'=>$ln['person']??'',
        ':due'=>$ln['due']??null,
        ':note'=>$ln['note']??'',
        ':ret'=> isset($ln['returnedAt']) ? intval($ln['returnedAt']) : null
      ]);
    }
    // settings
    $s=$b['settings']??[];
    $stmt=$pdo->prepare('UPDATE settings SET buffer=:buffer, debug=:debug,
      defaultTagsStock=:t1, defaultTagsAtelier=:t2,
      defaultLocationsStock=:l1, defaultLocationsAtelier=:l2
      WHERE id="settings"');
    $stmt->execute([
      ':buffer'=>intval($s['buffer']??0),
      ':debug'=>!empty($s['debug'])?1:0,
      ':t1'=>jenc($s['defaultTagsStock']??[]),
      ':t2'=>jenc($s['defaultTagsAtelier']??[]),
      ':l1'=>jenc($s['defaultLocationsStock']??[]),
      ':l2'=>jenc($s['defaultLocationsAtelier']??[])
    ]);

    $pdo->commit();
    ok(true);
  }catch(Exception $e){
    $pdo->rollBack();
    fail(400,'import-failed');
  }
}

fail(404,'no-route');
