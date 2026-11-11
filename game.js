const canvas=document.getElementById("gameCanvas");
const ctx=canvas.getContext("2d");
const W=900,H=500,WORLD=2600;
const $=id=>document.getElementById(id);
let player,enemies,coins,bullets,boss,camera=0,score=0,health=3,frame=0,running=false;
let audioCtx=null,lastAttack=0;
const keys={left:false,right:false};
const gravity=.62;
const platforms=[
{x:0,y:440,w:600,h:60},{x:680,y:440,w:450,h:60},
{x:1200,y:440,w:500,h:60},{x:1770,y:440,w:830,h:60},
{x:300,y:340,w:150,h:20},{x:790,y:330,w:180,h:20},
{x:1350,y:340,w:180,h:20},{x:1900,y:330,w:180,h:20},
{x:2250,y:350,w:150,h:20}
];

function sound(freq=440,duration=.08,type="sine",volume=.045){
 try{
  if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(60,freq*.55),audioCtx.currentTime+duration);
  g.gain.setValueAtTime(volume,audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);
  o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+duration);
 }catch(e){}
}
function resetGame(){
 player={x:60,y:300,w:34,h:48,vx:0,vy:0,speed:4.5,grounded:false,facing:1,attack:0,invincible:0,walk:0};
 enemies=[
  {x:500,y:395,w:35,h:45,dir:1,alive:true},
  {x:900,y:395,w:35,h:45,dir:-1,alive:true},
  {x:1500,y:395,w:35,h:45,dir:1,alive:true},
  {x:2050,y:395,w:35,h:45,dir:-1,alive:true}
 ];
 coins=[220,360,550,820,950,1300,1450,1650,1900,2200,2400].map((x,i)=>({x,y:i%2?380:300,collected:false}));
 bullets=[];boss={x:2410,y:365,w:76,h:75,hp:10,maxHp:10,dir:-1,alive:true,hitFlash:0};
 camera=0;score=0;health=3;frame=0;updateStats();
}
function updateStats(){
 $("score").textContent=score;$("health").textContent=health;
 $("bossHealth").textContent=boss&&boss.alive?`${boss.hp}/${boss.maxHp}`:"✓";
}
function startGame(){
 resetGame();$("startScreen").classList.add("hidden");
 $("gameOverScreen").classList.add("hidden");$("winScreen").classList.add("hidden");
 running=true;if(audioCtx&&audioCtx.state==="suspended")audioCtx.resume();
 sound(520,.13);requestAnimationFrame(gameLoop);
}
function gameOver(){
 running=false;$("finalScore").textContent=score;$("gameOverScreen").classList.remove("hidden");
 sound(110,.4,"sawtooth");
}
function victory(){
 running=false;$("winScreen").classList.remove("hidden");sound(660,.2);setTimeout(()=>sound(880,.3),160);
}
function jump(){
 if(running&&player.grounded){player.vy=-13;player.grounded=false;sound(300,.08);}
}
function attack(){
 if(!running||player.attack>0)return;
 player.attack=16;bullets.push({x:player.x+player.w/2,y:player.y+23,vx:player.facing*10,life:65});
 sound(720,.09,"triangle");
}
function damagePlayer(){
 if(player.invincible>0)return;
 health--;player.invincible=90;player.vy=-8;player.vx=-player.facing*4;
 updateStats();sound(130,.2,"sawtooth");
 if(health<=0)gameOver();
}
function updatePlayer(){
 player.vx=0;
 if(keys.left){player.vx=-player.speed;player.facing=-1;}
 if(keys.right){player.vx=player.speed;player.facing=1;}
 player.x+=player.vx;
 if(player.vx!==0)player.walk+=.22;
 player.vy+=gravity;player.y+=player.vy;player.grounded=false;
 for(const p of platforms){
  if(player.x+player.w>p.x&&player.x<p.x+p.w&&player.y+player.h>=p.y&&player.y+player.h<=p.y+25&&player.vy>=0){
   player.y=p.y-player.h;player.vy=0;player.grounded=true;
  }
 }
 if(player.y>H+100){damagePlayer();player.x=Math.max(20,player.x-100);player.y=250;}
 player.x=Math.max(0,Math.min(WORLD-player.w,player.x));
 if(player.attack>0)player.attack--;
 if(player.invincible>0)player.invincible--;
 camera=Math.max(0,Math.min(WORLD-W,player.x-W/3));
}
function updateEnemies(){
 for(const e of enemies){
  if(!e.alive)continue;
  e.x+=e.dir*1.25;if(e.x<390)e.dir=1;if(e.x>WORLD-400)e.dir=-1;
  if(player.x+player.w>e.x&&player.x<e.x+e.w&&player.y+player.h>e.y&&player.y<e.y+e.h)damagePlayer();
 }
}
function updateBoss(){
 if(!boss.alive)return;
 const distance=player.x-boss.x;
 if(Math.abs(distance)<420)boss.x+=Math.sign(distance)*.75;
 boss.x=Math.max(2250,Math.min(2500,boss.x));
 if(player.x+player.w>boss.x&&player.x<boss.x+boss.w&&player.y+player.h>boss.y&&player.y<boss.y+boss.h)damagePlayer();
 if(boss.hitFlash>0)boss.hitFlash--;
}
function updateCoins(){
 for(const c of coins){
  if(c.collected)continue;
  if(Math.hypot(player.x+17-c.x,player.y+24-c.y)<34){
   c.collected=true;score+=10;updateStats();sound(950,.07,"sine");
  }
 }
}
function updateBullets(){
 for(const b of bullets){
  b.x+=b.vx;b.life--;
  for(const e of enemies){
   if(e.alive&&b.x>e.x&&b.x<e.x+e.w&&b.y>e.y&&b.y<e.y+e.h){
    e.alive=false;b.life=0;score+=20;updateStats();sound(220,.12,"square");break;
   }
  }
  if(b.life>0&&boss.alive&&b.x>boss.x&&b.x<boss.x+boss.w&&b.y>boss.y&&b.y<boss.y+boss.h){
   boss.hp--;boss.hitFlash=8;b.life=0;score+=15;updateStats();sound(180,.1,"sawtooth");
   if(boss.hp<=0){boss.alive=false;score+=100;updateStats();sound(500,.25);}
  }
 }
 bullets=bullets.filter(b=>b.life>0);
}
function drawBackground(){
 const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,"#090d24");g.addColorStop(1,"#25123d");
 ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
 ctx.fillStyle="#d8c5ff";ctx.beginPath();ctx.arc(740-camera*.1,90,38,0,Math.PI*2);ctx.fill();
 for(let i=0;i<55;i++){let x=(i*173-camera*.2)%W;if(x<0)x+=W;ctx.fillStyle="#fff9";ctx.fillRect(x,(i*67)%230,2,2);}
 for(let i=0;i<16;i++){let x=i*190-camera*.35;ctx.fillStyle="#11152f";ctx.fillRect(x,270,100,170);ctx.fillStyle="#a855f7";for(let j=0;j<4;j++)ctx.fillRect(x+15+j*20,290,7,9);}
}
function drawPlatforms(){
 for(const p of platforms){const x=p.x-camera;if(x+p.w<0||x>W)continue;ctx.fillStyle="#191b35";ctx.fillRect(x,p.y,p.w,p.h);ctx.fillStyle="#9333ea";ctx.fillRect(x,p.y,p.w,5);}
}
function drawPlayer(){
 ctx.save();if(player.invincible>0&&frame%8<4)ctx.globalAlpha=.35;
 const x=player.x-camera,y=player.y;ctx.translate(x+17,y+24);if(player.facing<0)ctx.scale(-1,1);
 const swing=Math.sin(player.walk)*5;
 ctx.fillStyle="#0008";ctx.beginPath();ctx.ellipse(0,27,22,6,0,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle="#080810";ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(-7,12);ctx.lineTo(-9+swing,27);ctx.moveTo(7,12);ctx.lineTo(9-swing,27);ctx.stroke();
 ctx.fillStyle="#111";ctx.fillRect(-12,-7,24,27);
 ctx.fillStyle="#27213f";ctx.beginPath();ctx.arc(0,-16,16,0,Math.PI*2);ctx.fill();
 ctx.fillStyle="#c084fc";ctx.fillRect(2,-20,14,5);ctx.fillStyle="#fff";ctx.fillRect(8,-20,5,4);
 ctx.fillStyle="#9333ea";ctx.beginPath();ctx.moveTo(-12,-7);ctx.lineTo(-29,-3+Math.sin(frame*.2)*4);ctx.lineTo(-14,1);ctx.fill();
 ctx.strokeStyle="#d8b4fe";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(9,-3);ctx.lineTo(18,5+swing);ctx.stroke();
 if(player.attack>0){ctx.strokeStyle="#e9d5ff";ctx.lineWidth=5;ctx.beginPath();ctx.arc(20,0,27,-1.1,1.1);ctx.stroke();}
 ctx.restore();
}
function drawEnemies(){
 for(const e of enemies){if(!e.alive)continue;let x=e.x-camera;ctx.fillStyle="#b91c1c";ctx.fillRect(x,e.y,e.w,e.h);ctx.fillStyle="#fff";ctx.fillRect(x+7,e.y+10,6,6);ctx.fillRect(x+23,e.y+10,6,6);ctx.fillStyle="#111";ctx.fillRect(x+9,e.y+12,3,3);ctx.fillRect(x+25,e.y+12,3,3);}
}
function drawBoss(){
 if(!boss.alive)return;let x=boss.x-camera,y=boss.y;
 ctx.save();ctx.shadowColor="#ef4444";ctx.shadowBlur=20;
 ctx.fillStyle=boss.hitFlash?"#fff":"#7f1d1d";ctx.fillRect(x,y,boss.w,boss.h);
 ctx.fillStyle="#ef4444";ctx.beginPath();ctx.moveTo(x+8,y);ctx.lineTo(x+20,y-20);ctx.lineTo(x+30,y);ctx.moveTo(x+48,y);ctx.lineTo(x+60,y-20);ctx.lineTo(x+68,y);ctx.fill();
 ctx.fillStyle="#fff";ctx.fillRect(x+13,y+20,15,9);ctx.fillRect(x+49,y+20,15,9);
 ctx.fillStyle="#111";ctx.fillRect(x+18,y+22,6,6);ctx.fillRect(x+54,y+22,6,6);
 ctx.fillStyle="#fca5a5";ctx.fillRect(x+22,y+51,34,7);ctx.restore();
 ctx.fillStyle="#222";ctx.fillRect(x-5,y-34,86,9);ctx.fillStyle="#ef4444";ctx.fillRect(x-5,y-34,86*(boss.hp/boss.maxHp),9);
 ctx.fillStyle="#fff";ctx.font="bold 13px Arial";ctx.fillText("DEMON BOSS",x-3,y-42);
}
function drawCoins(){
 for(const c of coins){if(c.collected)continue;ctx.save();ctx.shadowColor="#facc15";ctx.shadowBlur=15;ctx.fillStyle="#facc15";ctx.beginPath();ctx.arc(c.x-camera,c.y+Math.sin(frame*.08+c.x)*3,10,0,Math.PI*2);ctx.fill();ctx.restore();}
}
function drawBullets(){
 for(const b of bullets){ctx.save();ctx.translate(b.x-camera,b.y);ctx.rotate(frame*.2);ctx.fillStyle="#d8b4fe";ctx.beginPath();for(let i=0;i<8;i++){let a=i*Math.PI/4,r=i%2===0?12:4;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();ctx.restore();}
}
function update(){
 frame++;updatePlayer();if(!running)return;
 updateEnemies();updateBoss();updateCoins();updateBullets();
 if(!boss.alive&&player.x>WORLD-100)victory();
}
function draw(){drawBackground();drawPlatforms();drawCoins();drawEnemies();drawBoss();drawBullets();drawPlayer();}
function gameLoop(){if(!running)return;update();draw();if(running)requestAnimationFrame(gameLoop);}
window.addEventListener("keydown",e=>{
 if(["ArrowLeft","ArrowRight","ArrowUp"," "].includes(e.key))e.preventDefault();
 if(e.key==="ArrowLeft"||e.key.toLowerCase()==="a")keys.left=true;
 if(e.key==="ArrowRight"||e.key.toLowerCase()==="d")keys.right=true;
 if((e.key==="ArrowUp"||e.key.toLowerCase()==="w")&&!e.repeat)jump();
 if(e.code==="Space"&&!e.repeat)attack();
});
window.addEventListener("keyup",e=>{
 if(e.key==="ArrowLeft"||e.key.toLowerCase()==="a")keys.left=false;
 if(e.key==="ArrowRight"||e.key.toLowerCase()==="d")keys.right=false;
});
function holdButton(id,key){
 const b=$(id);b.addEventListener("pointerdown",e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys[key]=true;});
 ["pointerup","pointercancel","lostpointercapture"].forEach(ev=>b.addEventListener(ev,()=>keys[key]=false));
}
holdButton("leftBtn","left");holdButton("rightBtn","right");
$("jumpBtn").addEventListener("pointerdown",e=>{e.preventDefault();jump();});
$("attackBtn").addEventListener("pointerdown",e=>{e.preventDefault();attack();});
$("startBtn").onclick=startGame;$("restartBtn").onclick=startGame;$("nextBtn").onclick=startGame;
resetGame();draw();
