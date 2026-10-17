"""Rebuild the editable cell and web GLB with Blender 4.5 LTS.

blender --background --python scripts/cell-3d/generate.py
Units are illustrative, not biological scale. Deterministic seed.
"""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/demos/assets/cell-3d"
SOURCE = ROOT / "output/cell-3d"
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
random.seed(24)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials):
    bpy.data.materials.remove(data)

def linear(c):
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4

def material(name, color, rough=.3, coat=.3, metal=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    rgb = tuple(linear(int(color[i:i+2], 16) / 255) for i in (1, 3, 5))
    shader.inputs["Base Color"].default_value = (*rgb, 1)
    shader.inputs["Roughness"].default_value = rough
    shader.inputs["Metallic"].default_value = metal
    shader.inputs["Coat Weight"].default_value = coat
    shader.inputs["Coat Roughness"].default_value = .22
    mat.diffuse_color = (*rgb, 1)
    return mat

mats = {
 "membrane": material("Membrana perlada", "#9c64db", .27, .5),
 "cytoplasm": material("Citoplasma lavanda", "#b583c6", .42, .18),
 "rim": material("Borde luminoso", "#dcc5fa", .23, .45),
 "nucleus": material("Envoltura nuclear", "#7c33b8", .30, .45),
 "nucleoplasm": material("Interior nuclear", "#ad78d2", .42, .2),
 "nucleolus": material("Nucleolo", "#432676", .23, .6),
 "chromatin": material("Cromatina", "#bc8ee4", .36, .2),
 "reticulum": material("Membranas del reticulo", "#9050c4", .29, .42),
 "reticulumEdge": material("Bordes del reticulo", "#d5a7f4", .25, .5),
 "ribosome": material("Ribosomas", "#ffbd5d", .3, .25),
 "mito": material("Membrana mitocondrial", "#dc6610", .27, .5),
 "mitoInner": material("Interior mitocondrial", "#e58b18", .38, .3),
 "crista": material("Crestas mitocondriales", "#ffda78", .25, .35),
 "golgi": material("Sacos de Golgi", "#0785bf", .25, .55),
 "golgiEdge": material("Bordes de Golgi", "#75d9ef", .23, .45),
 "lysosome": material("Lisosomas", "#e6b246", .3, .55),
 "vesicle": material("Vesiculas", "#a579cc", .25, .4),
}

def finish(obj, name, part, mat):
    obj.name = name
    obj["organelle"] = part
    obj.data.materials.clear()
    obj.data.materials.append(mats[mat])
    if obj.type == "MESH":
        for p in obj.data.polygons: p.use_smooth = True
    return obj

def mesh(name, verts, faces, part, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, part, mat)

def sphere(name, pos, scale, part, mat, detail=24, irregular=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=detail, ring_count=max(12,detail//2), location=pos)
    obj = bpy.context.object
    if irregular:
        for v in obj.data.vertices:
            p = v.co
            v.co *= 1 + irregular * math.sin(13*p.x+4*p.z)*math.sin(11*p.y-3*p.x)
    obj.scale = scale
    return finish(obj, name, part, mat)

def tube(name, points, radius, part, mat, sides=6, closed=False):
    # Explicit parallel frame, avoiding curve conversion/export inconsistencies.
    verts, faces = [], []
    points = [Vector(p) for p in points]
    for i, p in enumerate(points):
        tangent = (points[(i+1)%len(points)] - points[i-1]).normalized() if closed else (points[min(i+1,len(points)-1)] - points[max(0,i-1)]).normalized()
        normal = tangent.cross(Vector((0,0,1)))
        if normal.length < .01: normal = tangent.cross(Vector((0,1,0)))
        normal.normalize()
        binormal = tangent.cross(normal).normalized()
        for k in range(sides):
            t = 2*math.pi*k/sides
            verts.append(p + radius*(normal*math.cos(t)+binormal*math.sin(t)))
    for i in range(len(points) if closed else len(points)-1):
        for k in range(sides):
            a=i*sides+k; b=i*sides+(k+1)%sides
            c=((i+1)%len(points))*sides+(k+1)%sides;d=((i+1)%len(points))*sides+k
            faces.append((a,b,c,d))
    return mesh(name, verts, faces, part, mat)

def bowl(name, center, radius, stretch, height, part, mat, rim=True, phase=0):
    n, rings = 112, 32
    verts, faces = [], []
    for j in range(rings+1):
        theta=math.pi/2+(math.pi/2-.001)*j/rings
        for i in range(n):
            phi=2*math.pi*i/n
            wobble=1+.035*math.sin(phi*3+phase)+.018*math.cos(phi*5)
            r=radius*math.sin(theta)*wobble
            verts.append((center[0]+r*math.cos(phi),center[1]+r*stretch*math.sin(phi),center[2]+height*math.cos(theta)))
    for j in range(rings):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n
            faces.append((a,b,b+n,a+n))
    obj=mesh(name,verts,faces,part,mat)
    if rim:
        tube(name+" lip",verts[:n],.045,part,"rim",8,True)
    return obj

# Open cell, with thick concentric membrane edges and organic outline.
bowl("Membrana exterior",(0,0,.03),2.92,.9,1.4,"membrana","membrane")
bowl("Citoplasma",(0,0,.055),2.82,.9,1.30,"membrana","cytoplasm",False)
for r in (2.85,2.92):
    pts=[(r*(1+.035*math.sin(t*3)+.018*math.cos(t*5))*math.cos(t),r*.9*(1+.035*math.sin(t*3)+.018*math.cos(t*5))*math.sin(t),.075) for t in [i*math.tau/140 for i in range(140)]]
    tube("Doble borde",pts,.023,"membrana","rim",6,True)

# Cutaway nuclear envelope: the nucleolus is inside, visible through the opening.
nc=Vector((.42,.57,.31))
opening=Vector((0,-.62,.78)).normalized()
axis=Vector((1,0,0));other=opening.cross(axis)
verts=[];faces=[]
for j in range(41):
    theta=.87+(math.pi-.871)*j/40
    for i in range(80):
        phi=i*math.tau/80
        p=opening*math.cos(theta)+(axis*math.cos(phi)+other*math.sin(phi))*math.sin(theta)
        verts.append(nc+Vector((p.x*.88,p.y*.82,p.z*.84)))
for j in range(40):
    for i in range(80):
        a=j*80+i;b=j*80+(i+1)%80
        faces.append((a,b,b+80,a+80))
shell=mesh("Envoltura nuclear abierta",verts,faces,"nucleo","nucleus")
mod=shell.modifiers.new("Espesor nuclear","SOLIDIFY");mod.thickness=.035
bpy.context.view_layer.objects.active=shell;bpy.ops.object.modifier_apply(modifier=mod.name)
tube("Borde del corte nuclear",verts[:80],.022,"nucleo","chromatin",8,True)
sphere("Nucleoplasma",nc,(.72,.67,.69),"nucleo","nucleoplasm",48)
sphere("Nucleolo",nc+opening*.46+Vector((-.13,0,0)),(.26,.24,.25),"nucleo","nucleolus",36,.018)
# Chromatin within the opened nucleus, beneath its outer envelope.
for j in range(9):
    pts=[]
    for i in range(36):
        t=i/35
        theta=.30+j*.135+.14*math.sin(t*14+j)
        phi=-math.pi*.95+t*math.pi*1.4+.05*math.sin(t*20+j)
        pts.append(nc+Vector((.725*math.sin(theta)*math.cos(phi),.675*math.sin(theta)*math.sin(phi),.695*math.cos(theta))))
    tube("Cromatina",pts,.004,"nucleo","chromatin",5)
# Nuclear pores, small rings following the envelope.
for i in range(24):
    phi=random.uniform(0,math.tau);theta=random.uniform(.35,1.6)
    normal=Vector((math.sin(theta)*math.cos(phi),math.sin(theta)*math.sin(phi),math.cos(theta)))
    if normal.dot(opening)>math.cos(.90): continue
    p=nc+Vector((normal.x*.89,normal.y*.83,normal.z*.85))
    axis=normal.cross(Vector((0,0,1))).normalized();other=normal.cross(axis).normalized()
    tube("Poro nuclear",[p+.025*(axis*math.cos(t)+other*math.sin(t)) for t in [k*math.tau/12 for k in range(12)]],.009,"nucleo","chromatin",5,True)

# Broad folded sheets. Ribbons have actual thickness and a rounded lip.
for layer in range(5):
    verts, faces=[],[]
    n=88
    r=1.01+layer*.16
    for i in range(n+1):
        t=.0+i/n*math.pi*1.57
        for k in range(4):
            w=k/3
            rr=r+w*.13+.045*math.sin(t*8+layer*.7)
            z=.10+layer*.017+.18*math.sin(t*3+layer*.3)+w*.26
            verts.append((nc.x+rr*math.cos(t),nc.y+rr*.83*math.sin(t),z))
    for i in range(n):
        for k in range(3):
            a=i*4+k;faces.append((a,a+4,a+5,a+1))
    obj=mesh("Reticulo lamina "+str(layer),verts,faces,"reticulo","reticulum")
    mod=obj.modifiers.new("Espesor organico","SOLIDIFY");mod.thickness=.055
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
    tube("Reticulo borde",[verts[i*4+3] for i in range(n+1)],.031,"reticulo","reticulumEdge",6)
    for i in range(3,n-3,4):
        p=Vector(verts[i*4+2]);p.z+=.047
        sphere("Ribosoma adherido",p,(.035,.035,.03),"reticulo","ribosome",12)

# A cutaway mitochondrion with an elongated bean outline and folded cristae.
def mito(center, angle, size=1):
    def at(x,y,z):
        return Vector((center[0]+size*(x*math.cos(angle)-y*math.sin(angle)),center[1]+size*(x*math.sin(angle)+y*math.cos(angle)),center[2]+size*z))
    n,rings=80,20;verts=[];faces=[]
    for j in range(rings+1):
        theta=math.pi/2+(math.pi/2-.001)*j/rings
        for i in range(n):
            t=i*math.tau/n;r=math.sin(theta)
            verts.append(at(.79*r*math.cos(t),.40*r*math.sin(t)+.09*math.cos(t*2),-.40*math.cos(theta-math.pi)))
    for j in range(rings):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    mesh("Mitocondria abierta",verts,faces,"mitocondria","mito")
    # Matrix provides a warm floor behind the folded inner membrane.
    matrix=sphere("Matriz mitocondrial",at(0,0,-.09),(.73*size,.32*size,.17*size),"mitocondria","mitoInner",32)
    matrix.rotation_euler.z=angle
    tube("Borde mitocondrial",[at(.79*math.cos(t),.40*math.sin(t)+.09*math.cos(t*2),.02) for t in [i*math.tau/n for i in range(n)]],.043*size,"mitocondria","crista",8,True)
    for j in range(8):
        x=-.58+j*.16;extent=.25*math.sqrt(max(.1,1-(x/.78)**2))
        pts=[at(x+.046*math.sin(k/20*math.pi),-extent+2*extent*k/20,.045+.055*math.sin(k/20*math.pi)) for k in range(21)]
        tube("Cresta",pts,.035*size,"mitocondria","crista",8)
mito((-1.27,-.7,-.05),-.72,1.04)
mito((-1.72,.95,-.2),.65,.55)

# Flattened, curved sacs with closed surfaces, individually readable from the side.
for layer in range(6):
    pts=[]
    z=-.35+layer*.13
    width=.89-layer*.055
    for i in range(64):
        t=i/63*math.pi
        pts.append((.97+width*math.cos(t),-1.30+.33*math.sin(t)+.04*math.sin(t*4+layer),z+.07*math.sin(t)))
    # broad surface formed around a centerline with an elliptical cross-section
    verts=[];faces=[]
    for i,p in enumerate(pts):
        for k in range(12):
            t=k*math.tau/12
            verts.append((p[0],p[1]+.15*math.cos(t),p[2]+.065*math.sin(t)))
    for i in range(len(pts)-1):
        for k in range(12):
            a=i*12+k;b=i*12+(k+1)%12
            faces.append((a,b,b+12,a+12))
    faces.append(tuple(reversed(range(12))))
    faces.append(tuple((len(pts)-1)*12+k for k in range(12)))
    mesh("Golgi saco "+str(layer),verts,faces,"golgi","golgi")
    tube("Golgi borde",[(p[0],p[1]-.14,p[2]+.01) for p in pts],.024,"golgi","golgiEdge",6)

# Lysosome with a slightly granular surface, smaller transport vesicles.
sphere("Lisosoma",(-.38,-1.63,-.27),(.31,.3,.32),"lisosoma","lysosome",40,.03)
for i in range(90):
    t=random.random()*math.tau;u=random.uniform(-1,1);r=math.sqrt(1-u*u)
    p=Vector((-.38+r*math.cos(t)*.305,-1.63+r*math.sin(t)*.30,-.27+u*.32))
    sphere("Enzimas ilustradas",p,(.013,.013,.013),"lisosoma","ribosome",8)
for i,(x,y,z,r) in enumerate([(-2,-.1,-.12,.17),(-.7,-1.04,-.2,.13),(1.8,-.9,-.12,.17),(1.7,-1.53,-.2,.11),(-1.06,1.45,-.16,.16),(2.1,.28,-.12,.16)]):
    sphere("Vesicula "+str(i),(x,y,z),(r,r,r),"golgi" if x>0 else "lisosoma","golgi" if x>0 else "vesicle",24)
# Cytoplasmic granules without covering the primary organelles.
for i in range(110):
    t=random.uniform(0,math.tau);r=random.uniform(1.9,2.64)
    x=r*math.cos(t);y=r*.87*math.sin(t)
    z=.045-1.25*math.sqrt(max(0,1-(r/2.82)**2))+.07
    sphere("Granulo",(x,y,z),(.025,.025,.024),"membrana","vesicle" if i%3 else "ribosome",8)

# Join same organelle/material to keep the GPU draw-call count low.
groups={}
for obj in list(bpy.context.scene.objects):
    if obj.type=="MESH":
        key=(obj.get("organelle"),obj.active_material.name)
        groups.setdefault(key,[]).append(obj)
for (part,mat),objects in groups.items():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    if len(objects)>1: bpy.ops.object.join()
    obj=bpy.context.object;obj.name=part+"_"+mat;obj["organelle"]=part
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)

# Named anchors are semantic, independent of vertices or export order.
anchors={"nucleo":(.42,.57,1.02),"mitocondria":(-1.27,-.7,.17),"reticulo":(1.8,1.27,.3),"golgi":(.97,-1.3,.42),"lisosoma":(-.38,-1.63,.06),"membrana":(-2.5,.98,.08)}
for name,pos in anchors.items():
    obj=bpy.data.objects.new("anchor_"+name,None)
    bpy.context.collection.objects.link(obj);obj.location=pos
    obj["anchor"]=name

# Editable native source and portable web asset share the exact geometry.
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"celula.blend"))
bpy.ops.export_scene.gltf(filepath=str(OUT/"modelo-v1.glb"),export_format="GLB",export_extras=True,export_yup=True,export_cameras=False,export_lights=False,export_animations=False)
triangles=sum(len(obj.data.polygons) for obj in bpy.context.scene.objects if obj.type=="MESH")
print("CELL_EXPORT",{"polygons":triangles,"bytes":(OUT/"modelo-v1.glb").stat().st_size,"meshes":len(groups)})
